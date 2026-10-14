import { randomUUID } from 'crypto';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import type { Redis } from 'ioredis';
import {
  ApprovalScope,
  DiscountKind,
  DuplicateStrategy,
  EnrollmentStatus,
  FeeGenerationSource,
  FeeStatus,
  FeeType,
  FineTrigger,
  InvoiceKind,
  InvoiceStatus,
  PaymentAllocationType,
  PaymentMethod,
  PaymentStatus,
  PeriodType,
  WalletTransactionKind,
} from '@biddaloy/shared';
import { FeeStructure } from '../../../modules/fees/entities/fee-structure.entity';
import { FineRule } from '../../../modules/fees/entities/fine-rule.entity';
import { RecurringSchedule } from '../../../modules/fees/entities/recurring-schedule.entity';
import { RecurringScheduleStructure } from '../../../modules/fees/entities/recurring-schedule-structure.entity';
import { RecurringScheduleExclusion } from '../../../modules/fees/entities/recurring-schedule-exclusion.entity';
import { DiscountRule } from '../../../modules/fees/entities/discount-rule.entity';
import { FeeGeneration } from '../../../modules/fees/entities/fee-generation.entity';
import { StudentFee } from '../../../modules/fees/entities/student-fee.entity';
import { Payment } from '../../../modules/fees/entities/payment.entity';
import { PaymentAllocation } from '../../../modules/fees/entities/payment-allocation.entity';
import { Invoice } from '../../../modules/invoices/entities/invoice.entity';
import { InvoiceShareToken } from '../../../modules/invoices/entities/invoice-share-token.entity';
import { StudentWallet } from '../../../modules/fees/entities/student-wallet.entity';
import { WalletTransaction } from '../../../modules/fees/entities/wallet-transaction.entity';
import { FeeGenerationService } from '../../../modules/fees/fee-generation.service';
import { PaymentAllocationService } from '../../../modules/fees/payment-allocation.service';
import { WalletService } from '../../../modules/fees/wallet.service';
import { FineSweepService } from '../../../modules/fees/fines/fine-sweep.service';
import { FinesService } from '../../../modules/fees/fines/fines.service';
import { LateFeeService } from '../../../modules/fees/late-fee.service';
import { InvoicesService } from '../../../modules/invoices/invoices.service';
import { InvoiceShareService } from '../../../modules/invoices/invoice-share.service';
import { MONTH_NAMES } from '../../../modules/invoices/invoice-period.util';
import { APPROVAL_REDIS } from '../../../modules/auth/guards/approval.guard';
import {
  APPROVAL_TOKEN_AUDIENCE,
  JWT_ALGORITHM,
  JWT_ISSUER,
} from '../../../modules/auth/jwt-secrets';
import { School } from '../../../modules/schools/entities/school.entity';
import { buildIssuerSnapshot } from '../../../modules/schools/profile/issuer-snapshot';
import { insertChunked } from '../bulk';
import type { DemoSeedContext, DemoSlice } from '../context';
import { todayAt } from '../dates';
import { orgIds, type OrgTenant, type OrgYear } from './org';
import { studentIds, type DemoStudent } from './students';
import { unnestInsert } from './attendance';

/** Current-year monthly tuition per branch (D35); older years are back-calculated at ~5% a year. */
const TUITION: Record<OrgTenant['kind'], number> = { PRIMARY: 800, HIGH: 1200, COLLEGE: 1500 };
const GROWTH = 1.05;
const METHODS: readonly (readonly [PaymentMethod, number])[] = [
  [PaymentMethod.CASH, 60],
  [PaymentMethod.BKASH, 20],
  [PaymentMethod.NAGAD, 10],
  [PaymentMethod.BANK_TRANSFER, 10],
];
const CHRONIC_LATE = 0.05; // pay 1-3 months late
const CHRONIC_NEVER = 0.03; // stop paying a few months before last month
const PREV_PAID = 0.85; // ~15% of last month is overdue (D15)
const NOW_FULL = 0.7; // of the students who are clear, so ~60% of all (D15)
const NOW_PARTIAL = 0.12; // ~10% of all
const SIBLING_PCT = 10;
const MERIT_SHARE = 0.03;
const WALLET_SHARE = 0.05;
const DUE_DAYS = 9;
const PAGE = 5000; // `GenerateFeesDto.student_ids` cap

const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
const pad = (n: number) => String(n).padStart(2, '0');
const addDays = (d: string, n: number) =>
  new Date(Date.parse(d) + n * 86_400_000).toISOString().slice(0, 10);
/** `YYYY-MM` plus n months. */
const addMonths = (ym: string, n: number) => {
  const t = Number(ym.slice(0, 4)) * 12 + Number(ym.slice(5, 7)) - 1 + n;
  return `${Math.floor(t / 12)}-${pad((t % 12) + 1)}`;
};
const monthsBetween = (from: string, to: string): string[] => {
  const out: string[] = [];
  for (let m = from; m <= to; m = addMonths(m, 1)) out.push(m);
  return out;
};
const stream = (seed: number) => () => {
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

interface Structures {
  tuition: { id: string; name: string; amount: number };
  annual: { id: string; name: string; amount: number };
  exam: { id: string; name: string; amount: number };
}
interface BillRow {
  id: string;
  student_id: string;
  fee_structure_id: string;
  period_start: string;
  total: number;
  discount: number;
  due_date: string;
  tenant_id: string;
  name: string;
}

export const slice: DemoSlice = {
  name: 'fees',
  covers: [
    FeeStructure,
    FineRule,
    RecurringSchedule,
    RecurringScheduleStructure,
    RecurringScheduleExclusion,
    DiscountRule,
    FeeGeneration,
    StudentFee,
    Payment,
    PaymentAllocation,
    Invoice,
    InvoiceShareToken,
    StudentWallet,
    WalletTransaction,
  ],
  run: async (ctx: DemoSeedContext) => {
    const org = orgIds(ctx);
    const st = studentIds(ctx);
    const adminId = org.adminUserId;
    const rnd = stream(ctx.rng.number.int({ min: 1, max: 2 ** 31 - 1 }));
    const q = <T>(sql: string, args: unknown[] = []): Promise<T[]> => ctx.ds.query(sql, args);
    const method = () => {
      let r = rnd() * 100;
      for (const [m, w] of METHODS) if ((r -= w) < 0) return m;
      return PaymentMethod.CASH;
    };
    const reference = () =>
      `TRX${Math.floor(rnd() * 1e9)
        .toString(36)
        .toUpperCase()}`;
    const anchorMonth = ctx.anchor.slice(0, 7);
    const prevMonth = addMonths(anchorMonth, -1);
    const prevStart = `${prevMonth}-01`;
    let rows = 0;

    // --- who is billed ----------------------------------------------------------------------
    const byTenant = new Map<string, DemoStudent[]>();
    for (const s of st.students)
      (byTenant.get(s.tenantId) ?? byTenant.set(s.tenantId, []).get(s.tenantId)!).push(s);
    const inYear = (s: DemoStudent, y: OrgYear) => s.stays.some((x) => x.yearId === y.id);
    /** Per student: monthly tuition discount (percent); the scholarship student is never billed (excluded). */
    const pct = new Map<string, { pct: number; reason: string }>();
    const scholarship = new Map<string, string>(); // tenant -> student

    // --- structures, fine rules, discount rules (per tenant and year) -------------------------
    const structs = new Map<string, Structures>(); // `${tenant}|${year}`
    const fineStructs = new Map<string, { absent: string; late: string }>();
    const structRows: Record<string, unknown>[] = [];
    const ruleRows: Record<string, unknown>[] = [];
    for (const t of org.tenants) {
      t.years.forEach((y, yi) => {
        const back = t.years.length - 1 - yi;
        const tuition = Math.round(TUITION[t.kind] / GROWTH ** back / 10) * 10;
        const mk = (name: string, fee_type: FeeType, amount: number) => {
          const id = randomUUID();
          structRows.push({
            id,
            tenant_id: t.id,
            academic_year_id: y.id,
            name,
            fee_type,
            amount,
            class_id: null,
            section_id: null,
          });
          return { id, name, amount };
        };
        structs.set(`${t.id}|${y.id}`, {
          tuition: mk('মাসিক টিউশন ফি', FeeType.MONTHLY_TUITION, tuition),
          annual: mk('বার্ষিক সেশন ফি', FeeType.ANNUAL_FEE, tuition * 2),
          exam: mk('পরীক্ষা ফি', FeeType.EXAM_FEE, Math.round((tuition * 0.4) / 10) * 10),
        });
        if (yi >= t.years.length - 2) {
          const absent = mk('অনুপস্থিতি জরিমানা', FeeType.FINE, 20);
          const late = mk('বিলম্ব জরিমানা', FeeType.FINE, 10);
          fineStructs.set(`${t.id}|${y.id}`, { absent: absent.id, late: late.id });
          ruleRows.push({
            id: randomUUID(),
            tenant_id: t.id,
            academic_year_id: y.id,
            trigger: FineTrigger.ATTENDANCE_ABSENT,
            fee_structure_id: absent.id,
            class_id: null,
            free_per_period: 1,
            cap_per_period: 200,
            conditions: {},
            is_active: true,
            created_by_user_id: adminId,
          });
          ruleRows.push({
            id: randomUUID(),
            tenant_id: t.id,
            academic_year_id: y.id,
            trigger: FineTrigger.ATTENDANCE_LATE,
            fee_structure_id: late.id,
            class_id: null,
            free_per_period: 2,
            conditions: { min_minutes_late: 15 },
            is_active: true,
            created_by_user_id: adminId,
          });
        }
      });
    }
    rows += await insertChunked(ctx.ds.getRepository(FeeStructure), structRows as never);
    rows += await insertChunked(ctx.ds.getRepository(FineRule), ruleRows as never);

    // Sibling 10% (2nd child on) for families with 2+ children in a branch; merit 25/50/75% for ~3%.
    const discountRows: Record<string, unknown>[] = [];
    for (const t of org.tenants) {
      const cur = t.years[t.years.length - 1];
      const kids = (byTenant.get(t.id) ?? []).filter((s) => inYear(s, cur));
      const families = new Map<string, DemoStudent[]>();
      for (const s of kids) {
        const key = s.guardianIds[0];
        if (key) (families.get(key) ?? families.set(key, []).get(key)!).push(s);
      }
      for (const fam of families.values()) {
        for (const s of fam.slice(1)) pct.set(s.id, { pct: SIBLING_PCT, reason: 'ভাইবোন ছাড়' });
      }
      const free = kids.filter((s) => !pct.has(s.id));
      scholarship.set(t.id, free.splice(Math.floor(rnd() * free.length), 1)[0]?.id ?? '');
      const merit = Math.max(1, Math.round(kids.length * MERIT_SHARE));
      for (let i = 0; i < merit && free.length; i++) {
        const s = free.splice(Math.floor(rnd() * free.length), 1)[0];
        pct.set(s.id, { pct: [25, 50, 75][Math.floor(rnd() * 3)], reason: 'মেধা বৃত্তি' });
      }
      for (const s of kids) {
        const d = pct.get(s.id);
        if (!d) continue;
        discountRows.push({
          id: randomUUID(),
          tenant_id: t.id,
          student_id: s.id,
          kind: DiscountKind.PERCENT,
          value: d.pct,
          fee_types: [FeeType.MONTHLY_TUITION],
          reason: d.reason,
          created_by_user_id: adminId,
          is_active: true,
          approved_by_user_id: adminId,
        });
      }
    }
    rows += await insertChunked(ctx.ds.getRepository(DiscountRule), discountRows as never);

    /** Tuition after the student's standing discount (what a bill row carries). */
    const tuitionDiscount = (studentId: string, amount: number) => {
      const d = pct.get(studentId);
      return d ? round2((amount * d.pct) / 100) : 0;
    };
    /** Fee structures billed in the `i`th month of a year: tuition always, annual first, exam twice. */
    const billedIn = (s: Structures, i: number) => [
      s.tuition,
      ...(i === 0 ? [s.annual] : []),
      ...(i === 5 || i === 10 ? [s.exam] : []),
    ];
    const monthsOf = (y: OrgYear, last: string) =>
      monthsBetween(y.start.slice(0, 7), y.end.slice(0, 7) < last ? y.end.slice(0, 7) : last);

    // --- older years: bills in bulk, one FeeGeneration batch per tenant and month (D38) --------
    const batchRows: Record<string, unknown>[] = [];
    const billRows: Record<string, unknown>[] = [];
    for (const t of org.tenants) {
      for (const y of t.years.filter((x) => !x.isCurrent)) {
        const s = structs.get(`${t.id}|${y.id}`)!;
        const kids = (byTenant.get(t.id) ?? []).filter(
          (k) => inYear(k, y) && k.id !== scholarship.get(t.id),
        );
        monthsOf(y, addMonths(anchorMonth, -1)).forEach((m, i) => {
          const due = addDays(`${m}-01`, DUE_DAYS);
          const list = billedIn(s, i);
          const batchId = randomUUID();
          batchRows.push({
            id: batchId,
            tenant_id: t.id,
            academic_year_id: y.id,
            period_start: `${m}-01`,
            period_type: PeriodType.MONTH,
            due_date: due,
            source: FeeGenerationSource.MANUAL,
            generated_by_user_id: adminId,
            duplicate_strategy: DuplicateStrategy.SKIP,
            notify_families: false,
            structures: list.map((x) => ({
              id: x.id,
              name: x.name,
              fee_type:
                x === s.tuition
                  ? FeeType.MONTHLY_TUITION
                  : x === s.annual
                    ? FeeType.ANNUAL_FEE
                    : FeeType.EXAM_FEE,
              amount: x.amount,
            })),
            student_count: kids.length,
            generated_count: kids.length * list.length,
            skipped_count: 0,
            removed_count: 0,
          });
          for (const k of kids) {
            for (const x of list) {
              const discount = x === s.tuition ? tuitionDiscount(k.id, x.amount) : 0;
              billRows.push({
                student_id: k.id,
                academic_year_id: y.id,
                fee_structure_id: x.id,
                fee_generation_id: batchId,
                period_start: `${m}-01`,
                period_type: PeriodType.MONTH,
                occurrence: 1,
                total_amount: x.amount,
                paid_amount: 0,
                discount_amount: discount,
                standing_discount_amount: discount,
                one_off_discount_amount: 0,
                status: FeeStatus.PENDING,
                due_date: due,
              });
            }
          }
        });
      }
    }
    rows += await unnestInsert(
      ctx.ds,
      'fee_generations',
      Object.keys(batchRows[0] ?? { id: 0 }),
      batchRows,
    );
    if (billRows.length) {
      rows += await unnestInsert(ctx.ds, 'student_fees', Object.keys(billRows[0]), billRows);
    }

    // --- current year: a monthly schedule, then the real generator for each month ------------
    const gen = ctx.app.get(FeeGenerationService);
    const request = { headers: {} as Record<string, string> };
    for (const t of org.tenants) {
      const y = t.years[t.years.length - 1];
      const s = structs.get(`${t.id}|${y.id}`)!;
      const scheduleId = randomUUID();
      await insertChunked(ctx.ds.getRepository(RecurringSchedule), [
        {
          id: scheduleId,
          tenant_id: t.id,
          academic_year_id: y.id,
          name: 'মাসিক টিউশন ফি',
          audience: { enrollment_status: 'ACTIVE' },
          rule: { kind: 'MONTHLY', day_of_month: 1 },
          period_type: PeriodType.MONTH,
          due_days_after_period_start: DUE_DAYS,
          starts_on: y.start,
          ends_on: y.end,
          notify_families: true,
          is_active: true,
          last_run_period: `${anchorMonth}-01`,
          created_by_user_id: adminId,
        },
      ] as never);
      await insertChunked(ctx.ds.getRepository(RecurringScheduleStructure), [
        { schedule_id: scheduleId, fee_structure_id: s.tuition.id },
      ] as never);
      const excluded = scholarship.get(t.id);
      if (excluded) {
        await insertChunked(ctx.ds.getRepository(RecurringScheduleExclusion), [
          {
            schedule_id: scheduleId,
            student_id: excluded,
            reason: 'পূর্ণ বৃত্তি: মাসিক ফি প্রযোজ্য নয়',
            created_by_user_id: adminId,
          },
        ] as never);
      }
      rows += 3;
      const ids = (byTenant.get(t.id) ?? [])
        .filter((k) => inYear(k, y) && k.id !== excluded)
        .map((k) => k.id);
      for (const [i, m] of monthsOf(y, anchorMonth).entries()) {
        for (let p = 0; p < ids.length; p += PAGE) {
          const r = await gen.generate(
            {
              academic_year_id: y.id,
              period_start: `${m}-01`,
              period_type: PeriodType.MONTH,
              student_ids: ids.slice(p, p + PAGE),
              fee_structure_ids: billedIn(s, i).map((x) => x.id),
              due_date: addDays(`${m}-01`, DUE_DAYS),
              duplicate_strategy: DuplicateStrategy.SKIP,
              // Messages for months of backfill would be noise; the schedule row itself says true.
              notify_families: false,
            },
            t.id,
            adminId,
            request,
            { source: FeeGenerationSource.SCHEDULE, recurringScheduleId: scheduleId },
          );
          rows += r.generated_count + 1;
        }
      }
    }

    // --- bills before last month are settled in bulk: Payment + allocation + invoice ----------
    const issuers = new Map<string, ReturnType<typeof buildIssuerSnapshot>>();
    const schools = await ctx.ds
      .getRepository(School)
      .findBy(org.tenants.map((t) => ({ id: t.id })));
    for (const sc of schools) issuers.set(sc.id, buildIssuerSnapshot(sc));
    const people = new Map<string, { name: string; reg: string }>();
    for (const r of await q<{ id: string; full_name: string; registration_number: string }>(
      `SELECT id, full_name, registration_number FROM students WHERE tenant_id = ANY($1)`,
      [org.tenants.map((t) => t.id)],
    ))
      people.set(r.id, { name: r.full_name, reg: r.registration_number });
    const className = new Map<string, string>();
    for (const t of org.tenants)
      for (const y of t.years) for (const c of y.classes) className.set(`${y.id}|${c.id}`, c.name);
    const classOf = (s: DemoStudent, yearId: string) => {
      const stay = s.stays.find((x) => x.yearId === yearId);
      return stay ? (className.get(`${yearId}|${stay.classId}`) ?? null) : null;
    };
    const studentById = new Map(st.students.map((s) => [s.id, s]));
    // Students are walked in registration order, never uuid order: two runs must draw the same dice.
    const slugOf = new Map(org.tenants.map((t) => [t.id, t.slug]));
    const regKey = (id: string) =>
      `${slugOf.get(studentById.get(id)!.tenantId)}|${people.get(id)!.reg}`;
    const byReg = (a: [string, unknown], b: [string, unknown]) =>
      regKey(a[0]) < regKey(b[0]) ? -1 : 1;

    const payRows: Record<string, unknown>[] = [];
    const invRows: Record<string, unknown>[] = [];
    const allocRows: Record<string, unknown>[] = [];
    const settle = new Map<string, number>(); // student_fee id -> paid

    for (const t of org.tenants) {
      const bills = await q<BillRow>(
        `SELECT sf.id, sf.student_id, sf.fee_structure_id, sf.period_start::text AS period_start,
                sf.total_amount::float AS total, sf.discount_amount::float AS discount,
                sf.due_date::text AS due_date, st.tenant_id, fs.name
           FROM student_fees sf JOIN students st ON st.id = sf.student_id
           JOIN fee_structures fs ON fs.id = sf.fee_structure_id
          WHERE st.tenant_id = $1 AND sf.deleted_at IS NULL AND sf.status = 'PENDING'
            AND sf.period_start < $2
          ORDER BY sf.student_id, sf.period_start, fs.name`,
        [t.id, prevStart],
      );
      // Group per student, then per month: one payment a month (a late payer settles in one go).
      const perStudent = new Map<string, Map<string, BillRow[]>>();
      for (const b of bills) {
        const months =
          perStudent.get(b.student_id) ??
          perStudent.set(b.student_id, new Map()).get(b.student_id)!;
        const m = b.period_start.slice(0, 7);
        (months.get(m) ?? months.set(m, []).get(m)!).push(b);
      }
      const pending: { at: string; inv: Record<string, unknown> }[] = [];
      for (const [studentId, months] of [...perStudent].sort(byReg)) {
        const draw = rnd();
        const mode =
          draw < CHRONIC_NEVER ? 'NEVER' : draw < CHRONIC_NEVER + CHRONIC_LATE ? 'LATE' : 'ON_TIME';
        const delay = 1 + Math.floor(rnd() * 3);
        for (const [m, list] of months) {
          if (mode === 'NEVER' && m >= addMonths(prevMonth, -4)) continue;
          const payMonth = mode === 'LATE' ? addMonths(m, delay) : m;
          if (payMonth >= prevMonth) continue; // not settled yet: it stays due
          const day = mode === 'LATE' ? 1 + Math.floor(rnd() * 25) : 1 + Math.floor(rnd() * 8);
          const date = `${payMonth}-${pad(day)}`;
          const at = new Date(todayAt(date, 10, Math.floor(rnd() * 60)));
          const owed = list.map((b) => ({ b, due: round2(b.total - b.discount) }));
          const total = round2(owed.reduce((n, x) => n + x.due, 0));
          const pm = method();
          const payId = randomUUID();
          const invId = randomUUID();
          const who = people.get(studentId)!;
          const s = studentById.get(studentId)!;
          const ref = pm === PaymentMethod.CASH ? null : reference();
          const issuer = { ...issuers.get(t.id)!, captured_at: at.toISOString() };
          payRows.push({
            id: payId,
            student_id: studentId,
            total_amount: total,
            payment_method: pm,
            payment_status: PaymentStatus.SUCCESS,
            transaction_reference: ref,
            received_by_user_id: adminId,
            payment_date: at,
            tenant_id: t.id,
            tendered_amount: total,
            change_amount: 0,
            wallet_credit_used: 0,
            wallet_credit_added: 0,
            issuer_snapshot: issuer,
          });
          for (const { b, due } of owed) {
            allocRows.push({
              payment_id: payId,
              student_fee_id: b.id,
              allocated_amount: due,
              allocation_type:
                payMonth > m ? PaymentAllocationType.DUE : PaymentAllocationType.CURRENT,
              discount_amount: 0,
            });
            settle.set(b.id, due);
          }
          const year = Number(date.slice(0, 4));
          // Fee rows carry no tenant; the class comes from the stay of the bill's year.
          const yearOf = t.years.find((y) => y.start.slice(0, 7) <= m && m <= y.end.slice(0, 7))!;
          pending.push({
            at: at.toISOString(),
            inv: {
              id: invId,
              invoice_number: `INV-${year}-`, // the serial is added once payments are in order
              tenant_id: t.id,
              kind: InvoiceKind.INVOICE,
              student_id: studentId,
              payment_id: payId,
              total_amount: total,
              tax_amount: 0,
              discount_amount: round2(owed.reduce((x, y) => x + y.b.discount, 0)),
              status: InvoiceStatus.ISSUED,
              issued_date: at,
              due_date: at,
              issued_by_user_id: adminId,
              issuer_snapshot: issuer,
              snapshot: {
                issuer,
                students: [
                  {
                    id: studentId,
                    full_name: who.name,
                    registration_number: who.reg,
                    class_name: classOf(s, yearOf.id),
                    lines: owed.map(({ b, due }) => ({
                      fee_name: b.name,
                      period_label: `${MONTH_NAMES[Number(m.slice(5, 7)) - 1]} ${m.slice(0, 4)}`,
                      period_start: m,
                      amount: b.total,
                      discount: b.discount,
                      paid_this_time: due,
                      balance_after: 0,
                    })),
                  },
                ],
                totals: {
                  billed: round2(owed.reduce((x, y) => x + y.b.total, 0)),
                  discount: round2(owed.reduce((x, y) => x + y.b.discount, 0)),
                  paid: total,
                  change: 0,
                  wallet_used: 0,
                  wallet_added: 0,
                },
                payment: {
                  method: pm,
                  reference: ref,
                  received_by_name: null,
                  payment_date: at.toISOString(),
                },
              },
            },
          });
        }
      }
      // Invoice numbers run in payment order within a year, so number them after sorting.
      pending.sort((a, b) => (a.at < b.at ? -1 : 1));
      const next = new Map<string, number>();
      for (const p of pending) {
        const stem = p.inv.invoice_number as string;
        const n = (next.get(stem) ?? 0) + 1;
        next.set(stem, n);
        p.inv.invoice_number = `${stem}${String(n).padStart(5, '0')}`;
        invRows.push(p.inv);
      }
    }
    rows += await unnestInsert(ctx.ds, 'payments', Object.keys(payRows[0] ?? { id: 0 }), payRows);
    rows += await unnestInsert(ctx.ds, 'invoices', Object.keys(invRows[0] ?? { id: 0 }), invRows);
    // payments.invoice_id and invoices.payment_id point at each other: the payment goes in first.
    for (let i = 0; i < invRows.length; i += 5000) {
      const part = invRows.slice(i, i + 5000);
      await q(
        `UPDATE payments p SET invoice_id = v.inv FROM unnest($1::uuid[], $2::uuid[]) AS v(pay, inv)
          WHERE p.id = v.pay`,
        [part.map((r) => r.payment_id), part.map((r) => r.id)],
      );
    }
    rows += await unnestInsert(
      ctx.ds,
      'payment_allocations',
      Object.keys(allocRows[0] ?? { id: 0 }),
      allocRows,
    );
    const feeIds = [...settle.keys()];
    for (let i = 0; i < feeIds.length; i += 5000) {
      const part = feeIds.slice(i, i + 5000);
      await q(
        `UPDATE student_fees sf SET paid_amount = v.amt, status = 'PAID'
           FROM unnest($1::uuid[], $2::numeric[]) AS v(id, amt) WHERE sf.id = v.id`,
        [part, part.map((id) => settle.get(id))],
      );
    }

    // --- last month and this month: real payments through the real services ------------------
    const pay = ctx.app.get(PaymentAllocationService);
    const invoices = ctx.app.get(InvoicesService);
    const live = await q<BillRow & { status: string }>(
      `SELECT sf.id, sf.student_id, sf.period_start::text AS period_start,
              sf.total_amount::float AS total, sf.discount_amount::float AS discount,
              sf.paid_amount::float AS paid, st.tenant_id, sf.status
         FROM student_fees sf JOIN students st ON st.id = sf.student_id
        WHERE st.tenant_id = ANY($1) AND sf.deleted_at IS NULL AND sf.status IN ('PENDING', 'PARTIALLY_PAID')
        ORDER BY st.tenant_id, sf.student_id, sf.period_start`,
      [org.tenants.map((t) => t.id)],
    );
    const open = new Map<string, typeof live>();
    for (const b of live)
      (open.get(b.student_id) ?? open.set(b.student_id, []).get(b.student_id)!).push(b);
    // The service types a payment by the real clock's month, so use the same rule.
    const today = new Date();
    const clock = `${today.getFullYear()}-${pad(today.getMonth() + 1)}`;
    const typeOf = (m: string) =>
      m < clock ? PaymentAllocationType.DUE : PaymentAllocationType.CURRENT;
    for (const [studentId, list] of [...open].sort(byReg)) {
      const older = list.some((b) => b.period_start.slice(0, 7) < prevMonth);
      const prev = list.filter((b) => b.period_start.slice(0, 7) === prevMonth);
      const now = list.filter((b) => b.period_start.slice(0, 7) === anchorMonth);
      // FIFO: anyone with an older bill still open (or an unpaid last month) pays nothing now.
      if (older || (!prev.length && !now.length)) continue;
      const lines: { id: string; amount: number; month: string }[] = [];
      if (prev.length) {
        if (rnd() >= PREV_PAID) continue;
        for (const b of prev)
          lines.push({ id: b.id, amount: round2(b.total - b.discount), month: prevMonth });
      }
      const r = rnd();
      if (now.length && r < NOW_FULL) {
        for (const b of now)
          lines.push({ id: b.id, amount: round2(b.total - b.discount), month: anchorMonth });
      } else if (now.length === 1 && r < NOW_FULL + NOW_PARTIAL) {
        const due = round2(now[0].total - now[0].discount);
        lines.push({
          id: now[0].id,
          amount: Math.round((due * (0.4 + rnd() * 0.3)) / 10) * 10,
          month: anchorMonth,
        });
      }
      if (!lines.length) continue;
      const pm = method();
      const result = await pay.recordWithAllocation(
        {
          student_id: studentId,
          total_amount: round2(lines.reduce((n, l) => n + l.amount, 0)),
          payment_method: pm,
          allocations: lines.map((l) => ({
            student_fee_id: l.id,
            allocated_amount: l.amount,
            allocation_type: typeOf(l.month),
          })),
          transaction_reference: pm === PaymentMethod.CASH ? undefined : reference(),
        },
        list[0].tenant_id,
        adminId,
      );
      rows += 2 + lines.length;
      // A part payment gets no invoice from the service; staff issue one by hand, so do the same.
      if (!result.invoice) {
        await invoices.createFromPayment(result.id, list[0].tenant_id);
        rows += 1;
      }
    }

    // --- fines (last month's absences and lateness), late fees, three waivers ------------------
    for (const t of org.tenants) {
      await ctx.ds.query(
        `UPDATE schools SET settings = COALESCE(settings, '{}'::jsonb) || jsonb_build_object('fees',
           COALESCE(settings->'fees', '{}'::jsonb) || jsonb_build_object('lateFees', $2::jsonb))
          WHERE id = $1`,
        [
          t.id,
          JSON.stringify({
            [FeeType.MONTHLY_TUITION]: {
              enabled: true,
              grace_days: 7,
              kind: DiscountKind.FLAT,
              value: 50,
            },
          }),
        ],
      );
      const sweep = await ctx.app
        .get(FineSweepService)
        .generate(t.id, adminId, prevMonth, {}, DuplicateStrategy.SKIP, false, request, ctx.anchor);
      rows += sweep.generated_count;
      await ctx.app.get(LateFeeService).applyDue(t.id, ctx.anchor);
    }
    const high = org.tenants.find((t) => t.kind === 'HIGH')!;
    const fineBills = await q<{ id: string }>(
      `SELECT sf.id FROM student_fees sf JOIN students s ON s.id = sf.student_id
         JOIN fee_structures fs ON fs.id = sf.fee_structure_id
        WHERE s.tenant_id = $1 AND fs.fee_type = 'FINE' AND sf.status = 'PENDING' AND sf.deleted_at IS NULL
        ORDER BY s.registration_number, sf.total_amount LIMIT 3`,
      [high.id],
    );
    const jwt = ctx.app.get(JwtService);
    const secret = ctx.app.get(ConfigService).get<string>('JWT_SECRET');
    const redis = ctx.app.get<Redis>(APPROVAL_REDIS);
    for (const bill of fineBills) {
      // The seed acts as the school admin: it mints the same one-use approval token a step-up gives.
      const jti = randomUUID();
      await redis.set(`approval:${jti}`, '1', 'EX', 300);
      const token = await jwt.signAsync(
        {
          typ: 'approval',
          sub: adminId,
          act: adminId,
          tid: high.id,
          scope: ApprovalScope.FEES_DISCOUNT,
          jti,
        },
        {
          secret,
          algorithm: JWT_ALGORITHM,
          issuer: JWT_ISSUER,
          expiresIn: 300,
          audience: APPROVAL_TOKEN_AUDIENCE,
        },
      );
      await ctx.app
        .get(FinesService)
        .waiveBill(bill.id, { reason: 'বিশেষ বিবেচনায় জরিমানা মওকুফ' }, high.id, adminId, {
          headers: { 'x-approval-token': token },
          currentTenant: { id: high.id },
          user: { sub: adminId },
        });
      rows += 1;
    }

    // --- wallets: ~5% of families hold an advance; each branch has removed-bill credits and payouts ---
    const wallets = ctx.app.get(WalletService);
    for (const t of org.tenants) {
      const cur = t.years[t.years.length - 1];
      const kids = (byTenant.get(t.id) ?? []).filter(
        (k) => inYear(k, cur) && k.status === EnrollmentStatus.ACTIVE,
      );
      const withAdvance = Math.max(2, Math.round(kids.length * WALLET_SHARE));
      const picked: DemoStudent[] = [];
      while (picked.length < withAdvance && picked.length < kids.length) {
        const s = kids[Math.floor(rnd() * kids.length)];
        if (!picked.includes(s)) picked.push(s);
      }
      for (const [i, s] of picked.entries()) {
        const kind =
          i < 2
            ? WalletTransactionKind.CREDIT_BILL_REMOVED
            : WalletTransactionKind.CREDIT_OVERPAYMENT;
        await ctx.ds.transaction((manager) =>
          wallets.credit(
            {
              studentId: s.id,
              tenantId: t.id,
              amount: (2 + Math.floor(rnd() * 8)) * 100,
              kind,
              createdByUserId: adminId,
              note:
                kind === WalletTransactionKind.CREDIT_BILL_REMOVED
                  ? 'বাতিল বিলের জমা ফেরত'
                  : 'অগ্রিম জমা',
            },
            manager,
          ),
        );
        rows += 2;
      }
      // Two payouts of part of an advance.
      for (const s of picked.slice(0, 2)) {
        const balance = await wallets.balance(s.id, t.id);
        if (balance <= 0) continue;
        await ctx.ds.transaction((manager) =>
          wallets.payout(
            {
              studentId: s.id,
              tenantId: t.id,
              amount: Math.floor(balance / 2 / 10) * 10 || balance,
              reason: 'অভিভাবকের অনুরোধে নগদ ফেরত',
              actorUserId: adminId,
              approve: async () => adminId,
            },
            manager,
          ),
        );
        rows += 1;
      }
    }

    // --- share links for the three newest receipts at High (the public receipt link works) ---
    const share = ctx.app.get(InvoiceShareService);
    const recent = await q<{ id: string }>(
      `SELECT id FROM invoices WHERE tenant_id = $1 AND kind = 'INVOICE'
        ORDER BY issued_date DESC, invoice_number DESC LIMIT 3`,
      [high.id],
    );
    for (const inv of recent) {
      await share.createToken(inv.id, high.id, adminId);
      rows += 1;
    }
    return rows;
  },
};

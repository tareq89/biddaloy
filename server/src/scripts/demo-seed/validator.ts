import type { DataSource } from 'typeorm';
import { PaymentStatus, PeriodSlotKind, WalletTransactionKind } from '@biddaloy/shared';
import { checkSlot, type SlotLike } from '../../modules/routines/constraint-check';
import { DEMO_CARDS, DEMO_SCHOOL_SLUGS } from '../../modules/demo/demo-accounts';
import {
  isWeeklyOff,
  resolveAttendancePolicy,
} from '../../modules/attendance/attendance-policy.util';
import { resolveTenantSettings } from '../../modules/schools/settings/tenant-settings-resolver';

const DEMO = `s.slug LIKE 'bmsc-%'`;

export interface Violation {
  check: 'routine' | 'academic-year' | 'money' | 'attendance' | 'enrollment' | 'logins' | 'tenancy';
  message: string;
}

type Db = Pick<DataSource, 'query'>;
type Row = Record<string, any>;

/**
 * Each query starts with `/* check:<name> *\/` so a test fake can answer it without a database.
 * Same rule as the app's cross-branch clash check (`routine-slots.service.ts`): every non-deleted
 * routine counts (drafts too), and a slot's dates are clipped to its academic year.
 */
async function routine(ds: Db): Promise<Violation[]> {
  const rows: Row[] = await ds.query(`/* check:routine */
    SELECT rs.id, rs.section_id, rs.period_slot_id, rs.weekday, rs.subject_id, rs.room_id,
           rs.recurrence, rs.recurrence_offset,
           GREATEST(rs.valid_from, ay.start_date)::text AS valid_from,
           LEAST(COALESCE(rs.valid_to, ay.end_date), ay.end_date)::text AS valid_to,
           ps.starts_at::text AS starts_at,
           ps.ends_at::text AS ends_at, ps.sequence, ps.kind, t.user_id, s.slug
      FROM routine_slots rs
      JOIN routines r ON r.id = rs.routine_id AND r.deleted_at IS NULL
      JOIN academic_years ay ON ay.id = r.academic_year_id AND ay.deleted_at IS NULL
      JOIN schools s ON s.id = rs.tenant_id
      JOIN period_slots ps ON ps.id = rs.period_slot_id
      JOIN routine_slot_teachers rst ON rst.routine_slot_id = rs.id
      JOIN teachers t ON t.id = rst.teacher_id AND t.deleted_at IS NULL
     WHERE ${DEMO}`);
  // One entry per (slot, teacher user): a user teaching in two branches is one person (D12).
  const byUser = new Map<string, { slot: SlotLike; kind: PeriodSlotKind; slug: string }[]>();
  for (const r of rows) {
    const slot: SlotLike = {
      id: `${r.id}:${r.user_id}`,
      section_id: r.section_id,
      period_slot_id: r.period_slot_id,
      starts_at: r.starts_at.slice(0, 5),
      ends_at: r.ends_at.slice(0, 5),
      weekday: r.weekday,
      period_sequence: r.sequence,
      subject_id: r.subject_id,
      room_id: null, // rooms and sections are not what this check is about
      recurrence: r.recurrence,
      recurrence_offset: r.recurrence_offset,
      valid_from: r.valid_from,
      valid_to: r.valid_to,
      teacher_ids: [r.user_id],
    };
    (byUser.get(r.user_id) ?? byUser.set(r.user_id, []).get(r.user_id)!).push({
      slot,
      kind: r.kind,
      slug: r.slug,
    });
  }
  const out: Violation[] = [];
  for (const [user, items] of byUser) {
    for (const { slot, kind, slug } of items) {
      const res = checkSlot(
        { ...slot, section_id: `${slot.id}` }, // unique section so SECTION clash can't fire
        items.map((i) => ({ ...i.slot, section_id: i.slot.id! })),
        { id: slot.period_slot_id, kind },
        new Set([`${slot.id}`]),
        {},
      );
      if (res.violations.some((v) => v.code === 'TEACHER_DOUBLE_BOOKED')) {
        out.push({
          check: 'routine',
          message: `teacher user ${user} is double-booked on weekday ${slot.weekday} at ${slot.starts_at} (branch ${slug})`,
        });
      }
    }
  }
  return out;
}

async function academicYear(ds: Db): Promise<Violation[]> {
  const rows: Row[] = await ds.query(`/* check:academic-year */
    SELECT s.slug, count(ay.id)::int AS n
      FROM schools s LEFT JOIN academic_years ay
        ON ay.tenant_id = s.id AND ay.is_current AND ay.deleted_at IS NULL
     WHERE ${DEMO} GROUP BY s.slug HAVING count(ay.id) <> 1`);
  return rows.map((r) => ({
    check: 'academic-year',
    message: `${r.slug} has ${r.n} current academic years, expected exactly 1`,
  }));
}

/**
 * `paid_amount` moves with (a) allocations of live SUCCESS payments and (b) fee generation's wallet
 * auto-apply: a `DEBIT_GENERATION` row (stored negative) with no allocation, undone by a `REVERSAL`
 * credit. A reversed payment turns REFUNDED and gets a REFUNDED mirror with positive allocations;
 * PENDING/FAILED payments carry allocations that never touched `paid_amount`. Neither counts.
 * Checkout wallet use (`DEBIT_CHECKOUT`) is already inside that payment's allocations.
 * Waivers are not a column in the model, so they are not checked.
 */
async function money(ds: Db): Promise<Violation[]> {
  const [fees, allocations, wallet]: Row[][] = await Promise.all([
    ds.query(`/* check:money-fees */
      SELECT sf.id, sf.total_amount::float AS total, sf.paid_amount::float AS paid,
             sf.discount_amount::float AS discount
        FROM student_fees sf JOIN students st ON st.id = sf.student_id
        JOIN schools s ON s.id = st.tenant_id
       WHERE sf.deleted_at IS NULL AND ${DEMO}`),
    ds.query(`/* check:money-allocations */
      SELECT pa.student_fee_id, pa.allocated_amount::float AS allocated,
             pa.discount_amount::float AS discount, p.payment_status AS status,
             p.deleted_at IS NOT NULL AS deleted
        FROM payment_allocations pa JOIN payments p ON p.id = pa.payment_id
        JOIN schools s ON s.id = p.tenant_id
       WHERE ${DEMO}`),
    ds.query(`/* check:money-wallet */
      SELECT wt.student_fee_id, wt.kind, wt.amount::float AS amount
        FROM wallet_transactions wt JOIN schools s ON s.id = wt.tenant_id
       WHERE wt.student_fee_id IS NOT NULL AND ${DEMO}`),
  ]);
  const funded = new Map<string, number>();
  const allocDiscount = new Map<string, number>();
  const add = (m: Map<string, number>, k: string, v: number) => m.set(k, (m.get(k) ?? 0) + v);
  for (const a of allocations) {
    if (a.status !== PaymentStatus.SUCCESS || a.deleted) continue;
    add(funded, a.student_fee_id, a.allocated);
    add(allocDiscount, a.student_fee_id, a.discount);
  }
  for (const w of wallet) {
    if (
      w.kind === WalletTransactionKind.DEBIT_GENERATION ||
      w.kind === WalletTransactionKind.REVERSAL
    )
      add(funded, w.student_fee_id, -w.amount);
  }
  const out: Violation[] = [];
  for (const f of fees) {
    const paidBy = funded.get(f.id) ?? 0;
    if (Math.abs(f.paid - paidBy) > 0.005) {
      out.push({
        check: 'money',
        message: `student_fee ${f.id}: paid_amount ${f.paid} <> SUCCESS allocations + wallet auto-apply ${paidBy}`,
      });
    }
    const discount = allocDiscount.get(f.id) ?? 0;
    if (discount > f.discount + 0.005) {
      out.push({
        check: 'money',
        message: `student_fee ${f.id}: allocation discounts ${discount} exceed fee discount ${f.discount}`,
      });
    }
    if (f.paid + f.discount > f.total + 0.005) {
      out.push({
        check: 'money',
        message: `student_fee ${f.id}: paid ${f.paid} + discount ${f.discount} exceeds total ${f.total}`,
      });
    }
  }
  const noInvoice: Row[] = await ds.query(`/* check:money-invoice */
    SELECT p.id FROM payments p JOIN schools s ON s.id = p.tenant_id
     WHERE p.payment_status = 'SUCCESS' AND p.invoice_id IS NULL
       AND p.reversal_of_payment_id IS NULL AND p.deleted_at IS NULL AND ${DEMO}`);
  for (const p of noInvoice) {
    out.push({ check: 'money', message: `payment ${p.id} is SUCCESS but has no invoice` });
  }
  return out;
}

/** Weekly off days come from each branch's own settings (with history), like the app. */
async function attendance(ds: Db): Promise<Violation[]> {
  const rows: Row[] = await ds.query(
    `/* check:attendance */
    SELECT DISTINCT a.date::text AS date, s.slug, s.settings,
           EXISTS (SELECT 1 FROM calendar_events h
                    WHERE h.tenant_id = a.tenant_id AND h.deleted_at IS NULL
                      AND h.published_at IS NOT NULL AND h.counts_as_working_day = false
                      AND a.date BETWEEN h.start_date AND h.end_date
                      AND NOT EXISTS (SELECT 1 FROM calendar_event_classes ec
                                       WHERE ec.event_id = h.id)) AS holiday
      FROM attendance_sessions a JOIN schools s ON s.id = a.tenant_id
     WHERE ${DEMO}`,
  );
  return rows.flatMap((r) => {
    const off = isWeeklyOff(r.date, resolveAttendancePolicy(resolveTenantSettings(r.settings)));
    if (!off && !r.holiday) return [];
    return [
      {
        check: 'attendance' as const,
        message: `${r.slug} has an attendance session on ${r.date}, a ${off ? 'weekly off-day' : 'holiday'}`,
      },
    ];
  });
}

async function enrollment(ds: Db): Promise<Violation[]> {
  const rows: Row[] = await ds.query(`/* check:enrollment */
    SELECT e.student_id, e.academic_year_id, count(*)::int AS n
      FROM enrollments e JOIN schools s ON s.id = e.tenant_id
     WHERE e.enrollment_status = 'ACTIVE' AND ${DEMO}
     GROUP BY 1, 2 HAVING count(*) > 1`);
  return rows.map((r) => ({
    check: 'enrollment',
    message: `student ${r.student_id} has ${r.n} ACTIVE enrollments in year ${r.academic_year_id}`,
  }));
}

async function logins(ds: Db): Promise<Violation[]> {
  const rows: Row[] = await ds.query(
    `/* check:logins */
    SELECT u.email, s.slug
      FROM users u JOIN user_tenants ut ON ut.user_id = u.id
      JOIN schools s ON s.id = ut.tenant_id
     WHERE u.email = ANY($1) AND s.slug = ANY($2)
       AND u.deleted_at IS NULL AND ut.deleted_at IS NULL
    UNION ALL
    SELECT NULL, s.slug FROM schools s WHERE ${DEMO}`,
    [DEMO_CARDS.map((c) => c.email), [...DEMO_SCHOOL_SLUGS]],
  );
  // No demo branch yet (the org slice is still owed): nothing to check. Coverage rule (c) catches
  // a slice that claims to be done while the branches are missing.
  if (!rows.some((r) => r.email === null)) return [];
  const have = new Set(rows.map((r) => `${r.email}|${r.slug}`));
  return DEMO_CARDS.filter((c) => !have.has(`${c.email}|${c.branchSlug}`)).map((c) => ({
    check: 'logins',
    message: `demo card "${c.key}" (${c.email}) has no user with a membership in ${c.branchSlug}`,
  }));
}

/**
 * A person who acts on a branch's record belongs to that branch. The service layer trusts its caller
 * (the HTTP guard checks membership), so a slice that hands it another branch's user writes a decision
 * nobody in the branch can resolve. Covers who files, enters and decides applications, and every
 * actor on their history.
 */
async function tenancy(ds: Db): Promise<Violation[]> {
  const rows: Row[] = await ds.query(`/* check:tenancy */
    SELECT x.what, x.record_id, x.user_id, s.slug
      FROM (SELECT 'application applicant' AS what, a.id AS record_id, a.tenant_id, a.applicant_user_id AS user_id
              FROM applications a
            UNION ALL
            SELECT 'application entered_by', a.id, a.tenant_id, a.entered_by_user_id FROM applications a
            UNION ALL
            SELECT 'application decider', a.id, a.tenant_id, a.decided_by_user_id FROM applications a
            UNION ALL
            SELECT 'application event actor', e.application_id, e.tenant_id, e.actor_user_id
              FROM application_events e) x
      JOIN schools s ON s.id = x.tenant_id
     WHERE ${DEMO} AND x.user_id IS NOT NULL
       AND NOT EXISTS (SELECT 1 FROM user_tenants ut
                        WHERE ut.user_id = x.user_id AND ut.tenant_id = x.tenant_id AND ut.deleted_at IS NULL)
     LIMIT 50`);
  return rows.map((r) => ({
    check: 'tenancy',
    message: `${r.what} ${r.user_id} on ${r.record_id} has no membership in ${r.slug}`,
  }));
}

/** Runs every invariant against the seeded demo tenants (`bmsc-*`). Empty array = healthy. */
export async function validate(ds: Db): Promise<Violation[]> {
  const parts = await Promise.all(
    [routine, academicYear, money, attendance, enrollment, logins, tenancy].map((c) => c(ds)),
  );
  return parts.flat();
}

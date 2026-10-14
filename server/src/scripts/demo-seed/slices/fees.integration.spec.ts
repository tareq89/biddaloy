import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { DataSource } from 'typeorm';
import Redis from 'ioredis';
import type { TestingModule } from '@nestjs/testing';
import { getQueueToken } from '@nestjs/bullmq';
import { getDataSourceToken } from '@nestjs/typeorm';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { createTestModule } from '@test/helpers/module.helper';
import { ALL_ENTITIES } from '@test/all-entities';
import { AuditService } from '../../../modules/audit/audit.service';
import { StorageService } from '../../../modules/storage/storage.service';
import { StorageModule } from '../../../modules/storage/storage.module';
import { TenantSettingsCache } from '../../../modules/schools/settings/tenant-settings-cache.service';
import { SchoolsService } from '../../../modules/schools/schools.service';
import { resolveTenantSettings } from '../../../modules/schools/settings/tenant-settings-resolver';
import { SchoolSettingsReader } from '../../../modules/schools/settings/school-settings-reader.service';
import { PresetApplyService } from '../../../modules/presets/preset-apply.service';
import { PresetRegistryService } from '../../../modules/presets/preset-registry.service';
import { AuthTokenService } from '../../../modules/account-access/auth-token.service';
import { SchoolInviteService } from '../../../modules/account-access/school-invite.service';
import { StaffProfilesService } from '../../../modules/staff-profiles/staff-profiles.service';
import { TeacherService, UserService } from '../../../modules/users/users.service';
import { AccessTokenDenylistService } from '../../../modules/auth/access-token-denylist.service';
import { SessionCutoffService } from '../../../modules/auth/session-cutoff.service';
import { RefreshTokenService } from '../../../modules/auth/refresh-token.service';
import { ACCESS_TOKEN_TTL_MS } from '../../../modules/auth/auth-tokens';
import { ApprovalService } from '../../../modules/auth/guards/approval.guard';
import { PromotionsService } from '../../../modules/promotions/promotions.service';
import { EnrollmentService } from '../../../modules/enrollments/enrollments.service';
import { StudentLifecycleService } from '../../../modules/students/student-lifecycle.service';
import { FEE_NOTIFY_QUEUE } from '../../../modules/communications/communications.constants';
import {
  FeeGenerationService,
  NoopDiscountResolver,
} from '../../../modules/fees/fee-generation.service';
import { FeeGenerationsService } from '../../../modules/fees/fee-generations.service';
import { WalletService } from '../../../modules/fees/wallet.service';
import { DiscountRulesService } from '../../../modules/fees/discount-rules.service';
import { PaymentAllocationService } from '../../../modules/fees/payment-allocation.service';
import { FineSweepService } from '../../../modules/fees/fines/fine-sweep.service';
import { FinesService } from '../../../modules/fees/fines/fines.service';
import { LateFeeService } from '../../../modules/fees/late-fee.service';
import { InvoicesService } from '../../../modules/invoices/invoices.service';
import { InvoiceShareService } from '../../../modules/invoices/invoice-share.service';
import { SchoolCalendarService } from '../../../modules/calendar/school-calendar.service';
import { createContext, type DemoSeedContext } from '../context';
import { validate } from '../validator';
import { slice as org } from './org';
import { slice as staff } from './staff';
import { slice as students } from './students';
import { slice as attendance } from './attendance';
import { slice } from './fees';

const ANCHOR = '2026-10-10';
const PREV_START = '2026-09-01'; // first day of the month before the anchor
const FAKE_NOW = `${ANCHOR}T06:00:00Z`; // the clock the slice runs under
const SCALE = 0.1;
const YEARS = 2;
const JWT_SECRET = 'fees-slice-spec-secret-0123456789abcdef';
const DEMO = `s.slug LIKE 'bmsc-%'`;
const DEMO_STUDENT = `s.tenant_id IN (SELECT id FROM schools WHERE slug LIKE 'bmsc-%')`;

describe('fees slice (integration, 2 years, scale 0.1)', () => {
  let ds: DataSource;
  let ctx: DemoSeedContext;
  let app: TestingModule;
  let redis: Redis;
  const q = <T = Record<string, any>>(sql: string, args: unknown[] = []): Promise<T[]> =>
    ds.query(sql, args);

  beforeAll(async () => {
    redis = new Redis(process.env.REDIS_URL ?? 'redis://127.0.0.1:6379');
    const module: TestingModule = await createTestModule(
      ALL_ENTITIES,
      [
        PresetApplyService,
        PresetRegistryService,
        AuditService,
        AuthTokenService,
        SchoolInviteService,
        StaffProfilesService,
        UserService,
        TeacherService,
        PromotionsService,
        EnrollmentService,
        StudentLifecycleService,
        {
          provide: SchoolsService,
          useValue: { getResolvedSettings: async () => resolveTenantSettings(null) },
        },
        { provide: SchoolSettingsReader, useValue: { routineSettings: async () => ({}) } },
        { provide: ACCESS_TOKEN_TTL_MS, useValue: 900_000 },
        {
          provide: AccessTokenDenylistService,
          useValue: { revokeUserTokensIssuedBefore: vi.fn() },
        },
        { provide: SessionCutoffService, useValue: { cutOff: vi.fn() } },
        { provide: RefreshTokenService, useValue: {} },
        { provide: TenantSettingsCache, useValue: { invalidate: vi.fn() } },
        { provide: StorageService, useValue: { put: async () => undefined } },
        // fees
        ApprovalService,
        JwtService,
        { provide: 'APPROVAL_REDIS', useValue: redis },
        {
          provide: ConfigService,
          useValue: { get: (key: string) => (key === 'JWT_SECRET' ? JWT_SECRET : undefined) },
        },
        { provide: getQueueToken(FEE_NOTIFY_QUEUE), useValue: { add: vi.fn() } },
        FeeGenerationService,
        FeeGenerationsService,
        WalletService,
        DiscountRulesService,
        { provide: NoopDiscountResolver, useExisting: DiscountRulesService },
        PaymentAllocationService,
        InvoicesService,
        InvoiceShareService,
        FineSweepService,
        FinesService,
        LateFeeService,
        SchoolCalendarService,
      ],
      [StorageModule],
    );
    ds = module.get<DataSource>(getDataSourceToken());
    app = module;
  }, 120_000);

  // The suite empties data tables before every `it`, so the slices run here and one `it` reads.
  beforeEach(async () => {
    await ds.query(`DELETE FROM schools WHERE slug LIKE 'bmsc-%'`);
    await ds.query(`DELETE FROM users WHERE email LIKE '%@bmsc.example'`);
    await ds.query(`DELETE FROM public_holiday_sets WHERE country = 'BD'`);
    ctx = await createContext({
      ds,
      app,
      scale: SCALE,
      years: YEARS,
      anchor: ANCHOR,
      password: 'unit-test-password',
    });
    await org.run(ctx);
    await staff.run(ctx);
    await students.run(ctx);
    await attendance.run(ctx);
    // The payment service types a payment by the real clock's month, so the clock is the anchor.
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(FAKE_NOW));
    const t0 = Date.now();
    try {
      await slice.run(ctx);
    } finally {
      vi.useRealTimers();
    }
    console.log(`fees slice: ${Date.now() - t0} ms`);
  }, 900_000);

  afterAll(async () => {
    if (ds) await ds.destroy();
    redis?.disconnect();
  });

  it('writes a consistent ledger: bills, payments, invoices, discounts, fines, wallets', async () => {
    // The 58.1.05 money check: paid = sum of allocations, discounts within the fee, every payment invoiced.
    expect((await validate(ds)).filter((v) => v.check === 'money')).toEqual([]);

    // Per student: sum(fees) = sum(allocations) + sum(discounts, waivers included) + outstanding.
    const broken = await q(
      `SELECT sf.student_id
         FROM student_fees sf
         JOIN students s ON s.id = sf.student_id AND ${DEMO_STUDENT}
         LEFT JOIN (SELECT student_fee_id, sum(allocated_amount) AS paid
                      FROM payment_allocations GROUP BY student_fee_id) a ON a.student_fee_id = sf.id
        WHERE sf.deleted_at IS NULL
        GROUP BY sf.student_id
       HAVING abs(sum(sf.total_amount) - (COALESCE(sum(a.paid), 0) + sum(sf.discount_amount)
                + sum(sf.total_amount - sf.discount_amount - sf.paid_amount))) > 0.005`,
    );
    expect(broken).toEqual([]);

    // Every full payment has exactly one invoice; invoice numbers are unique per branch.
    const [{ n: unpaired }] = await q(
      `SELECT count(*) AS n FROM payments p JOIN schools s ON s.id = p.tenant_id AND ${DEMO}
        WHERE p.payment_status = 'SUCCESS'
          AND (SELECT count(*) FROM invoices i WHERE i.payment_id = p.id AND i.kind = 'INVOICE') <> 1`,
    );
    expect(Number(unpaired), 'unpaired').toBe(0);
    const [{ dup }] = await q(
      `SELECT count(*) - count(DISTINCT (tenant_id, invoice_number)) AS dup FROM invoices`,
    );
    expect(Number(dup), 'dup').toBe(0);
    // A payment and its invoice point at each other and share a branch.
    const [{ n: orphans }] = await q(
      `SELECT count(*) AS n FROM payments p LEFT JOIN invoices i ON i.id = p.invoice_id
        WHERE p.tenant_id IN (SELECT id FROM schools WHERE slug LIKE 'bmsc-%')
          AND (i.id IS NULL OR i.tenant_id <> p.tenant_id OR i.payment_id <> p.id)`,
    );
    expect(Number(orphans), 'orphans').toBe(0);

    // This month's tuition: 50-70% fully paid; some part paid; the rest due.
    const [now] = await q(
      `SELECT count(*) AS n, count(*) FILTER (WHERE sf.status = 'PAID') AS paid,
              count(*) FILTER (WHERE sf.status = 'PARTIALLY_PAID') AS part
         FROM student_fees sf JOIN fee_structures fs ON fs.id = sf.fee_structure_id
         JOIN students s ON s.id = sf.student_id AND ${DEMO_STUDENT}
        WHERE fs.fee_type = 'MONTHLY_TUITION' AND sf.period_start = date_trunc('month', $1::date)`,
      [ANCHOR],
    );
    expect(Number(now.paid) / Number(now.n)).toBeGreaterThanOrEqual(0.5);
    expect(Number(now.paid) / Number(now.n)).toBeLessThanOrEqual(0.7);
    expect(Number(now.part)).toBeGreaterThan(0);

    // Methods are about 60 / 30 / 10 (cash / mobile / bank), within 10 points.
    const [methods] = await q(
      `SELECT 100.0 * count(*) FILTER (WHERE payment_method = 'CASH') / count(*) AS cash,
              100.0 * count(*) FILTER (WHERE payment_method IN ('BKASH', 'NAGAD')) / count(*) AS mobile,
              100.0 * count(*) FILTER (WHERE payment_method = 'BANK_TRANSFER') / count(*) AS bank
         FROM payments p JOIN schools s ON s.id = p.tenant_id AND ${DEMO}`,
    );
    expect(Math.abs(Number(methods.cash) - 60)).toBeLessThan(10);
    expect(Math.abs(Number(methods.mobile) - 30)).toBeLessThan(10);
    expect(Math.abs(Number(methods.bank) - 10)).toBeLessThan(10);

    // A sibling discount only goes to a student whose guardian has 2+ children in that branch.
    const lonely = await q(
      `SELECT d.student_id FROM discount_rules d
        WHERE d.reason = 'ভাইবোন ছাড়' AND NOT EXISTS (
          SELECT 1 FROM student_guardians sg
           JOIN student_guardians other ON other.guardian_id = sg.guardian_id AND other.student_id <> sg.student_id
           JOIN students o ON o.id = other.student_id AND o.tenant_id = d.tenant_id
          WHERE sg.student_id = d.student_id)`,
    );
    expect(lonely).toEqual([]);

    // A bulk-inserted bill fills the same columns as one the generator wrote.
    const filled = async (source: string) => {
      const [row] = await q(
        `SELECT sf.* FROM student_fees sf JOIN fee_generations g ON g.id = sf.fee_generation_id
          WHERE g.source = $1 AND sf.discount_amount = 0 ORDER BY sf.period_start LIMIT 1`,
        [source],
      );
      return Object.keys(row)
        .filter((k) => row[k] !== null)
        .sort();
    };
    expect(await filled('MANUAL')).toEqual(await filled('SCHEDULE'));

    // The scholarship student is excluded from the schedule and never billed.
    const [{ n: excluded }] = await q(
      `SELECT count(*) AS n FROM recurring_schedule_exclusions e
         JOIN student_fees sf ON sf.student_id = e.student_id
         JOIN fee_structures fs ON fs.id = sf.fee_structure_id AND fs.fee_type = 'MONTHLY_TUITION'`,
    );
    expect(Number(excluded), 'excluded').toBe(0);

    // Fines were billed from last month's attendance, and three were waived at High.
    const [{ n: fines }] = await q(
      `SELECT count(*) AS n FROM student_fees sf JOIN fee_structures fs ON fs.id = sf.fee_structure_id
        WHERE fs.fee_type = 'FINE'`,
    );
    expect(Number(fines)).toBeGreaterThan(0);
    const [{ n: waived }] = await q(
      `SELECT count(*) AS n FROM student_fees sf JOIN fee_structures fs ON fs.id = sf.fee_structure_id
        WHERE fs.fee_type = 'FINE' AND sf.one_off_discount_amount > 0`,
    );
    expect(Number(waived)).toBe(Math.min(3, Number(fines)));

    // Wallets show both directions: advances and removed-bill credits in, payouts out.
    const kinds = await q(`SELECT DISTINCT kind FROM wallet_transactions ORDER BY kind`);
    expect(kinds.map((k) => k.kind)).toEqual(
      expect.arrayContaining(['CREDIT_BILL_REMOVED', 'CREDIT_OVERPAYMENT', 'DEBIT_PAYOUT']),
    );

    // Late fees were applied to last month's overdue tuition (applyDue swallows its errors, so check).
    const [{ n: lateFees }] = await q(
      `SELECT count(*) AS n FROM student_fees sf JOIN fee_structures fs ON fs.id = sf.fee_structure_id
         JOIN students s ON s.id = sf.student_id AND ${DEMO_STUDENT}
        WHERE fs.fee_type = 'LATE_FEE' AND sf.deleted_at IS NULL`,
    );
    expect(Number(lateFees), 'late fees').toBeGreaterThan(0);

    // Chronic payers still owe bills older than last month; others owe only last month.
    const [due] = await q(
      `SELECT count(DISTINCT sf.student_id) FILTER (WHERE sf.period_start < $1::date) AS chronic,
              count(DISTINCT sf.student_id) FILTER (WHERE sf.period_start = $1::date) AS overdue
         FROM student_fees sf JOIN fee_structures fs ON fs.id = sf.fee_structure_id
         JOIN students s ON s.id = sf.student_id AND ${DEMO_STUDENT}
        WHERE fs.fee_type = 'MONTHLY_TUITION' AND sf.deleted_at IS NULL
          AND sf.status IN ('PENDING', 'PARTIALLY_PAID')`,
      [PREV_START],
    );
    expect(Number(due.chronic), 'chronic').toBeGreaterThan(0);
    expect(Number(due.overdue), 'overdue last month').toBeGreaterThan(0);

    // Invoice numbers are INV-YYYY-NNNNN, and the live ones continue the bulk serials of their year.
    const [{ n: badNumbers }] = await q(
      `SELECT count(*) AS n FROM invoices i JOIN schools s ON s.id = i.tenant_id AND ${DEMO}
        WHERE i.kind = 'INVOICE' AND i.invoice_number !~ '^INV-[0-9]{4}-[0-9]{5}$'`,
    );
    expect(Number(badNumbers), 'bad invoice numbers').toBe(0);
    // Bulk payments are dated before last month; live ones at the faked clock.
    const serials = await q<{ bulk_max: number | null; live_min: number | null }>(
      `SELECT max(substr(i.invoice_number, 10)::int) FILTER (WHERE p.payment_date < $1::date) AS bulk_max,
              min(substr(i.invoice_number, 10)::int) FILTER (WHERE p.payment_date >= $1::date) AS live_min
         FROM invoices i JOIN payments p ON p.id = i.payment_id
         JOIN schools s ON s.id = i.tenant_id AND ${DEMO}
        WHERE i.kind = 'INVOICE'
        GROUP BY i.tenant_id, substr(i.invoice_number, 5, 4)`,
      [PREV_START],
    );
    const continued = serials.filter((r) => r.bulk_max !== null && r.live_min !== null);
    expect(continued.length, 'branch-years with bulk and live invoices').toBeGreaterThan(0);
    for (const r of continued) expect(Number(r.live_min)).toBeGreaterThan(Number(r.bulk_max));

    // Three live share links. expires_at is computed in JS under the faked clock, so compare with that
    // clock, not the database's now() (that would start failing 30 days after the anchor).
    const links = await q(`SELECT 1 FROM invoice_share_tokens WHERE expires_at > $1::timestamptz`, [
      FAKE_NOW,
    ]);
    expect(links).toHaveLength(3);
  }, 120_000);
});

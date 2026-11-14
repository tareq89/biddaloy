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
import { YearRolloverService } from '../../../modules/academics/year-rollover.service';
import { FeeStructureService } from '../../../modules/fees/fees.service';
import { GradingService } from '../../../modules/grading/grading.service';
import { AcademicTermsService } from '../../../modules/calendar/academic-terms.service';
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
import { CheckoutService } from '../../../modules/fees/checkout.service';
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
import { slice as fees } from './fees';
import { slice, PROOF_STATUS_COUNTS } from './payment-submissions';
import { ProofSubmissionsService } from '../../../modules/payment-submissions/proof-submissions.service';
import { ProofReviewService } from '../../../modules/payment-submissions/proof-review.service';
import { PaymentSubmissionSettlement } from '../../../modules/fees/payment-submission-settlement.service';
import { FamilyAccessService } from '../../../modules/students/family-access.service';

const ANCHOR = '2026-10-10';
const PREV_START = '2026-09-01'; // first day of the month before the anchor
const FAKE_NOW = `${ANCHOR}T06:00:00Z`; // the clock the slice runs under
const SCALE = 0.25; // login guardians are 5% of families: 0.1 leaves fewer than 7 open bills
const YEARS = 2;
const JWT_SECRET = 'fees-slice-spec-secret-0123456789abcdef';
const DEMO = `s.slug LIKE 'bmsc-%'`;
const DEMO_STUDENT = `s.tenant_id IN (SELECT id FROM schools WHERE slug LIKE 'bmsc-%')`;

describe('payment-submissions slice (integration, 2 years, scale 0.25)', () => {
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
        YearRolloverService,
        FeeStructureService,
        GradingService,
        AcademicTermsService,
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
          useValue: {
            // Reads what the slice wrote, so proofs are on.
            getResolvedSettings: async (id: string) =>
              resolveTenantSettings(
                (await ds.query(`SELECT settings FROM schools WHERE id = $1`, [id]))[0].settings,
              ),
          },
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
        CheckoutService,
        InvoicesService,
        InvoiceShareService,
        FineSweepService,
        FinesService,
        LateFeeService,
        SchoolCalendarService,
        ProofSubmissionsService,
        ProofReviewService,
        PaymentSubmissionSettlement,
        FamilyAccessService,
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
      await fees.run(ctx);
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

  it('writes one proof per state in bmsc-high, all through the services', async () => {
    const byStatus = await q(
      `SELECT status, count(*)::int AS n FROM payment_submissions WHERE source = 'PROOF' GROUP BY status`,
    );
    expect(Object.fromEntries(byStatus.map((r) => [r.status, r.n]))).toEqual(PROOF_STATUS_COUNTS);

    // The second waiting proof reuses the first one's TrxID, so the reviewer sees the flag (D25).
    const flags = await q(
      `SELECT reason_code FROM payment_submission_events
        WHERE from_status IS NULL AND reason_code IS NOT NULL`,
    );
    expect(flags.map((f) => f.reason_code)).toEqual(['DUPLICATE_PENDING']);

    // Rejected is IMAGE_UNCLEAR; the two confirmed ones were settled.
    const [rej] = await q(
      `SELECT reject_reason FROM payment_submissions WHERE status = 'REJECTED'`,
    );
    expect(rej.reject_reason).toBe('IMAGE_UNCLEAR');
    const [{ n: settled }] = await q(
      `SELECT count(*)::int AS n FROM payment_submissions WHERE status = 'CONFIRMED' AND settled_at IS NOT NULL`,
    );
    expect(settled).toBe(2);

    // Proofs are on in all three branches, and every proof is in bmsc-high.
    const [{ n: off }] = await q(
      `SELECT count(*)::int AS n FROM schools WHERE slug LIKE 'bmsc-%'
          AND settings->'payments'->>'proofEnabled' IS DISTINCT FROM 'true'`,
    );
    expect(off).toBe(0);
    const [{ n: elsewhere }] = await q(
      `SELECT count(*)::int AS n FROM payment_submissions p JOIN schools s ON s.id = p.tenant_id
        WHERE s.slug <> 'bmsc-high'`,
    );
    expect(elsewhere).toBe(0);

    // The money stays consistent after confirm and the counter payment.
    expect((await validate(ds)).filter((v) => v.check === 'money')).toEqual([]);
  });
});

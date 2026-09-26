import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { Repository, DataSource } from 'typeorm';
import { getRepositoryToken } from '@nestjs/typeorm';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';
import { FeesDailyScheduler } from './fees-daily.scheduler';
import {
  FeeGenerationService,
  NoopDiscountResolver,
  feesEvents,
  FEES_GENERATED_EVENT,
} from './fee-generation.service';
import { FeeGenerationsService } from './fee-generations.service';
import { WalletService } from './wallet.service';
import { AuditService } from '../audit/audit.service';
import { ApprovalService } from '../auth/guards/approval.guard';
import { PaymentAllocationService } from './payment-allocation.service';
import { InvoicesService } from '../invoices/invoices.service';
import { StorageModule } from '../storage/storage.module';
import { RecurringSchedulesService } from './recurring-schedules.service';
import { FeeStructure } from './entities/fee-structure.entity';
import { StudentFee } from './entities/student-fee.entity';
import { FeeGeneration } from './entities/fee-generation.entity';
import { Student } from '../students/entities/student.entity';
import { School } from '../schools/entities/school.entity';
import { Program } from '../programs/entities/program.entity';
import { ProgramEnrollment } from '../programs/entities/program-enrollment.entity';
import { createTestModule } from '@test/helpers/module.helper';
import { ALL_ENTITIES } from '@test/all-entities';
import {
  SEED_TENANT_ID,
  SEED_ACADEMIC_YEAR_ID,
  SEED_SECTION_1_ID,
  SEED_SECTION_2_ID,
  SEED_ADMIN_USER_ID,
} from '@test/constants';
import { FeeGenerationSource, FeeType, ProgramEnrollmentStatus } from '@biddaloy/shared';
import { SCHOOL_TZ, todayInSchoolTz } from '../../common/time';

/**
 * [16.7.2] Real-DB coverage for `FeesDailyScheduler`. #675 ([16.7.1])
 * has landed on this branch, so `recurring_schedules` /
 * `recurring_schedule_structures` / `recurring_schedule_exclusions`
 * and `RecurringSchedulesService` are real here — this suite seeds a
 * schedule through that service, runs the scheduler's actual sweep
 * (`process()`), and asserts against real `FeeGeneration`/`StudentFee`
 * rows.
 *
 * Unit coverage (`fees-daily.scheduler.spec.ts`) already exercises the
 * scheduling/transaction/idempotency logic against a mocked
 * `DataSource`/`EntityManager` — this file only needs to prove the real
 * raw-SQL contract (`fees-daily.scheduler.ts`'s top-of-file comment)
 * actually matches #675's real tables and `RecurringSchedulesService`.
 *
 * Late-fee threading (`LateFeeService`, [16.7.4]/#678) is intentionally
 * NOT exercised here — the scheduler takes it via `@Optional()` and this
 * suite never registers it, matching the "may be undefined" contract
 * documented on `FeesDailyScheduler`'s constructor. That's covered by
 * `late-fee.service.integration.spec.ts` instead.
 */
describe('FeesDailyScheduler (integration)', () => {
  let dataSource: DataSource;
  let redis: Redis;
  let feeGenerationService: FeeGenerationService;
  let recurringSchedulesService: RecurringSchedulesService;
  let feeGenerationRepo: Repository<FeeGeneration>;
  let studentFeeRepo: Repository<StudentFee>;
  let structureRepo: Repository<FeeStructure>;
  let studentRepo: Repository<Student>;
  let programRepo: Repository<Program>;
  let programEnrollmentRepo: Repository<ProgramEnrollment>;

  const TENANT_ID = SEED_TENANT_ID;
  const JWT_SECRET = 'test-fees-daily-scheduler-secret';

  let studentSeq = 0;
  let structureSeq = 0;

  function makeStudent(overrides: Partial<Student> = {}) {
    studentSeq += 1;
    return studentRepo.create({
      full_name: `Scheduler Student ${studentSeq}`,
      registration_number: `REG-SCHED-INT-${String(studentSeq).padStart(4, '0')}`,
      roll_number: studentSeq,
      class_section_id: SEED_SECTION_1_ID,
      tenant_id: TENANT_ID,
      date_of_birth: new Date('2015-01-01'),
      preferred_communication: 'SMS',
      enrollment_status: 'ACTIVE',
      ...overrides,
    } as Partial<Student>);
  }

  function makeStructure(overrides: Partial<FeeStructure> = {}) {
    structureSeq += 1;
    return structureRepo.create({
      fee_type: FeeType.MONTHLY_TUITION,
      name: `Scheduler Tuition ${structureSeq}`,
      amount: 500,
      academic_year_id: SEED_ACADEMIC_YEAR_ID,
      tenant_id: TENANT_ID,
      ...overrides,
    } as Partial<FeeStructure>);
  }

  /**
   * A rule that's due "today" (`todayInSchoolTz()`), for whatever day the
   * suite happens to run on — without faking the system clock.
   *
   * `isDue()`'s WEEKLY branch compares against `Date#getUTCDay()`, which is
   * 0 (Sunday) - 6 (Saturday), but `RecurringSchedulesService.validateRule`
   * only accepts `weekdays` values 1-7 — so a real WEEKLY schedule can
   * never be persisted with a Sunday in its `weekdays` (0 is rejected,
   * and 7 never matches `getUTCDay()`'s 0-6 range). That mismatch is a
   * pre-existing quirk of the persisted-rule code, out of scope for this
   * suite to fix — MONTHLY with today's exact `day_of_month` sidesteps it
   * entirely and is due on any day 1-28 of the month.
   */
  function dueRuleToday():
    { kind: 'MONTHLY'; day_of_month: number } | { kind: 'WEEKLY'; weekdays: number[] } {
    const dayOfMonth = Number(todayInSchoolTz().slice(8, 10));
    if (dayOfMonth <= 28) {
      return { kind: 'MONTHLY', day_of_month: dayOfMonth };
    }
    // Rare fallback (29th-31st only): WEEKLY across every persistable
    // weekday. Misses only if the suite happens to run on a Sunday.
    return { kind: 'WEEKLY', weekdays: [1, 2, 3, 4, 5, 6, 7] };
  }

  async function createDueSchedule(overrides: {
    fee_structure_ids: string[];
    notify_families?: boolean;
  }) {
    return recurringSchedulesService.create(
      {
        academic_year_id: SEED_ACADEMIC_YEAR_ID,
        name: `Due schedule ${Date.now()}-${Math.random()}`,
        audience: { section_id: SEED_SECTION_1_ID, enrollment_status: 'ACTIVE' },
        rule: dueRuleToday(),
        fee_structure_ids: overrides.fee_structure_ids,
        starts_on: '2026-01-01',
        // No explicit ends_on -- defaults to the academic year's own
        // end_date (resolveEndsOn), which stays correct if the seeded
        // year's bounds ever change rather than hardcoding a literal.
        notify_families: overrides.notify_families ?? true,
      } as any,
      TENANT_ID,
      SEED_ADMIN_USER_ID,
    );
  }

  beforeAll(async () => {
    redis = new Redis(process.env.REDIS_URL ?? 'redis://127.0.0.1:6379');

    const module = await createTestModule(
      ALL_ENTITIES,
      [
        FeeGenerationService,
        FeeGenerationsService,
        WalletService,
        AuditService,
        NoopDiscountResolver,
        ApprovalService,
        PaymentAllocationService,
        InvoicesService,
        RecurringSchedulesService,
        JwtService,
        { provide: 'APPROVAL_REDIS', useValue: redis },
        ConfigService,
        { provide: 'JWT_SECRET', useValue: JWT_SECRET },
      ],
      [StorageModule],
    );

    feeGenerationService = module.get(FeeGenerationService);
    recurringSchedulesService = module.get(RecurringSchedulesService);
    feeGenerationRepo = module.get(getRepositoryToken(FeeGeneration));
    studentFeeRepo = module.get(getRepositoryToken(StudentFee));
    structureRepo = module.get(getRepositoryToken(FeeStructure));
    studentRepo = module.get(getRepositoryToken(Student));
    programRepo = module.get(getRepositoryToken(Program));
    programEnrollmentRepo = module.get(getRepositoryToken(ProgramEnrollment));
    dataSource = module.get(DataSource);

    // Baseline school row for SEED_TENANT_ID already exists via
    // reset-order.ts's reference reset SQL, but the scheduler's
    // `schoolsService.findAll()` path needs it to have status ACTIVE
    // (the default) — nothing further to seed here.
  }, 60000);

  afterAll(async () => {
    redis.disconnect();
    if (dataSource) {
      await dataSource.destroy();
    }
  });

  beforeEach(async () => {
    await redis.flushdb();
    await dataSource.query('DELETE FROM recurring_schedule_exclusions');
    await dataSource.query('DELETE FROM recurring_schedule_structures');
    await dataSource.query('DELETE FROM recurring_schedules');
    await dataSource.query('DELETE FROM student_fees');
    await dataSource.query('DELETE FROM fee_generations');
    await dataSource.query('DELETE FROM fee_structures');
    await dataSource.query('DELETE FROM program_enrollments');
    await dataSource.query('DELETE FROM programs');
    await dataSource.query('DELETE FROM students');
  });

  /** [34.2.2] A tenant-owned program plus one ACTIVE ProgramEnrollment for
   * `studentId` — the "program audience" fixture every program test below
   * builds on. */
  async function enrollInNewProgram(studentId: string, status = ProgramEnrollmentStatus.ACTIVE) {
    const program = await programRepo.save(
      programRepo.create({ tenant_id: TENANT_ID, name: `Program ${Date.now()}-${Math.random()}` }),
    );
    await programEnrollmentRepo.save(
      programEnrollmentRepo.create({
        tenant_id: TENANT_ID,
        program_id: program.id,
        student_id: studentId,
        started_on: '2026-01-01',
        status,
      }),
    );
    return program;
  }

  /** Builds a scheduler wired to the real DataSource/FeeGenerationService,
   * but a stub queue/schoolsService — `runNow`/`onModuleInit` aren't under
   * test here, and scoping every sweep to `TENANT_ID` via `job.data`
   * (matching `fees-daily.scheduler.spec.ts`'s pattern) avoids depending
   * on `SchoolsService.findAll()`'s own tenant-listing behavior.
   */
  function buildScheduler(): FeesDailyScheduler {
    const queue = { upsertJobScheduler: async () => undefined, add: async () => undefined } as any;
    const schoolsService = { findAll: async () => [] } as any;
    return new FeesDailyScheduler(queue, dataSource, schoolsService, feeGenerationService);
  }

  it('runs a due schedule and writes a FeeGeneration row with source SCHEDULE, notify_families threaded, last_run_period set', async () => {
    const structure = await structureRepo.save(makeStructure());
    await studentRepo.save(makeStudent());
    await studentRepo.save(makeStudent());

    const schedule = await createDueSchedule({
      fee_structure_ids: [structure.id],
      notify_families: true,
    });

    const events: any[] = [];
    const listener = (payload: any) => events.push(payload);
    feesEvents.on(FEES_GENERATED_EVENT, listener);

    const scheduler = buildScheduler();
    const today = todayInSchoolTz();

    try {
      await scheduler.process({ data: { tenantId: TENANT_ID } } as any);
    } finally {
      feesEvents.off(FEES_GENERATED_EVENT, listener);
    }

    const bills = await studentFeeRepo.find();
    expect(bills).toHaveLength(2);

    const batches = await feeGenerationRepo.find();
    expect(batches).toHaveLength(1);
    expect(batches[0].source).toBe(FeeGenerationSource.SCHEDULE);
    expect(batches[0].recurring_schedule_id).toBe(schedule.id);
    expect(batches[0].notify_families).toBe(true);

    // [CodeRabbit review, PR #801] notify event only fires after the
    // schedule's own transaction (bills + last_run_period update)
    // actually committed.
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      tenantId: TENANT_ID,
      feeGenerationId: batches[0].id,
    });

    const [row] = await dataSource.query(
      `SELECT last_run_period FROM recurring_schedules WHERE id = $1`,
      [schedule.id],
    );
    expect(row.last_run_period).not.toBeNull();
    // `last_run_period` is a `date` column — TypeORM's postgres driver
    // registers a type parser that coerces it to a JS `Date` even on a
    // raw `dataSource.query()`/`manager.query()` call (not just through
    // repository/entity reads), so compare it as one rather than as the
    // ISO string `periodFor()` produces.
    const lastRunPeriod = new Date(row.last_run_period);
    expect(lastRunPeriod.getUTCFullYear()).toBe(Number(today.slice(0, 4)));
  });

  // [Found via this test] `runSchedule`'s idempotency checks
  // (`schedule.last_run_period === period` / `fresh.last_run_period ===
  // freshPeriod`, `fees-daily.scheduler.ts`) originally compared a
  // pg-driver-coerced `Date` object against `periodFor()`'s ISO *string*
  // with strict `===` — always `false`, so a second same-day sweep never
  // short-circuited. `duplicate_strategy: SKIP` kept the actual
  // `StudentFee` bills idempotent regardless, but a second
  // `FeeGeneration` batch row and a second notify event fired every time.
  // The scheduler's own unit spec (`fees-daily.scheduler.spec.ts`) never
  // caught this because it mocks `manager.query`/`dataSource.query` with
  // plain JS object literals, bypassing the real pg driver's type
  // coercion entirely. Fixed in `fees-daily.scheduler.ts` by casting
  // `starts_on`/`ends_on`/`last_run_period` to `::text` in both raw
  // SELECTs, so the JS side always compares strings.
  it('is idempotent: a second sweep the same period does not create a second FeeGeneration batch', async () => {
    const structure = await structureRepo.save(makeStructure());
    await studentRepo.save(makeStudent());

    await createDueSchedule({ fee_structure_ids: [structure.id] });

    const scheduler = buildScheduler();
    await scheduler.process({ data: { tenantId: TENANT_ID } } as any);
    await scheduler.process({ data: { tenantId: TENANT_ID } } as any);

    const batches = await feeGenerationRepo.find();
    expect(batches).toHaveLength(1);
    const bills = await studentFeeRepo.find();
    expect(bills).toHaveLength(1);
  });

  it('does not notify when notify_families is false on the schedule', async () => {
    const structure = await structureRepo.save(makeStructure());
    await studentRepo.save(makeStudent());

    await createDueSchedule({ fee_structure_ids: [structure.id], notify_families: false });

    const events: any[] = [];
    const listener = (payload: any) => events.push(payload);
    feesEvents.on(FEES_GENERATED_EVENT, listener);

    const scheduler = buildScheduler();
    try {
      await scheduler.process({ data: { tenantId: TENANT_ID } } as any);
    } finally {
      feesEvents.off(FEES_GENERATED_EVENT, listener);
    }

    const batches = await feeGenerationRepo.find();
    expect(batches).toHaveLength(1);
    expect(batches[0].notify_families).toBe(false);
    expect(events).toHaveLength(0);
  });

  it('skips a student excluded on the schedule', async () => {
    const structure = await structureRepo.save(makeStructure());
    const included = await studentRepo.save(makeStudent());
    const excluded = await studentRepo.save(makeStudent());

    const schedule = await createDueSchedule({ fee_structure_ids: [structure.id] });
    await recurringSchedulesService.addExclusion(
      schedule.id,
      { student_id: excluded.id, reason: 'Sponsored' },
      TENANT_ID,
      SEED_ADMIN_USER_ID,
    );

    const scheduler = buildScheduler();
    await scheduler.process({ data: { tenantId: TENANT_ID } } as any);

    const bills = await studentFeeRepo.find();
    expect(bills).toHaveLength(1);
    expect(bills[0].student_id).toBe(included.id);
  });

  it('does not run a schedule whose window does not cover today (out-of-window)', async () => {
    const structure = await structureRepo.save(makeStructure());
    await studentRepo.save(makeStudent());

    // starts_on the academic year's own end_date — guaranteed in the
    // future relative to "today" for as long as this suite runs within
    // that year (every other test in this file already assumes that),
    // without hardcoding a literal year that goes stale once it passes.
    // The scheduler's date-window check (`fresh.starts_on > today`)
    // skips it.
    const [{ end_date: academicYearEnd }] = await dataSource.query(
      `SELECT end_date::text FROM academic_years WHERE id = $1`,
      [SEED_ACADEMIC_YEAR_ID],
    );
    const yearEnd = new Date(academicYearEnd).toISOString().slice(0, 10);
    await recurringSchedulesService.create(
      {
        academic_year_id: SEED_ACADEMIC_YEAR_ID,
        name: `Future schedule ${Date.now()}`,
        audience: { section_id: SEED_SECTION_1_ID, enrollment_status: 'ACTIVE' },
        rule: dueRuleToday(),
        fee_structure_ids: [structure.id],
        starts_on: yearEnd,
        ends_on: yearEnd,
      } as any,
      TENANT_ID,
      SEED_ADMIN_USER_ID,
    );

    const scheduler = buildScheduler();
    await scheduler.process({ data: { tenantId: TENANT_ID } } as any);

    const bills = await studentFeeRepo.find();
    expect(bills).toHaveLength(0);
    const batches = await feeGenerationRepo.find();
    expect(batches).toHaveLength(0);
  });

  it('marks the schedule as run without creating a FeeGeneration when the audience resolves empty', async () => {
    const structure = await structureRepo.save(makeStructure());
    // No students in SEED_SECTION_1_ID this test's own seeded set.

    const schedule = await createDueSchedule({ fee_structure_ids: [structure.id] });

    const scheduler = buildScheduler();
    await scheduler.process({ data: { tenantId: TENANT_ID } } as any);

    const batches = await feeGenerationRepo.find();
    expect(batches).toHaveLength(0);

    const [row] = await dataSource.query(
      `SELECT last_run_period FROM recurring_schedules WHERE id = $1`,
      [schedule.id],
    );
    expect(row.last_run_period).not.toBeNull();
  });

  // [34.2.2] Program-audience targeting — D7/D17/D26.
  describe('program audience', () => {
    it('bills only students with an ACTIVE program enrolment', async () => {
      const structure = await structureRepo.save(makeStructure());
      const enrolled = await studentRepo.save(makeStudent());
      const notEnrolled = await studentRepo.save(makeStudent());
      const program = await enrollInNewProgram(enrolled.id);

      const schedule = await recurringSchedulesService.create(
        {
          academic_year_id: SEED_ACADEMIC_YEAR_ID,
          name: `Program schedule ${Date.now()}`,
          audience: { program_id: program.id, enrollment_status: 'ACTIVE' },
          rule: dueRuleToday(),
          fee_structure_ids: [structure.id],
          starts_on: '2026-01-01',
        } as any,
        TENANT_ID,
        SEED_ADMIN_USER_ID,
      );

      const scheduler = buildScheduler();
      await scheduler.process({ data: { tenantId: TENANT_ID } } as any);

      const bills = await studentFeeRepo.find();
      expect(bills).toHaveLength(1);
      expect(bills[0].student_id).toBe(enrolled.id);
      void notEnrolled;
      void schedule;
    });

    it('stops billing once the program enrolment goes WITHDRAWN, leaving the earlier bill untouched', async () => {
      const structure = await structureRepo.save(makeStructure());
      const student = await studentRepo.save(makeStudent());
      const program = await enrollInNewProgram(student.id);

      const schedule = await recurringSchedulesService.create(
        {
          academic_year_id: SEED_ACADEMIC_YEAR_ID,
          name: `Program schedule ${Date.now()}`,
          audience: { program_id: program.id, enrollment_status: 'ACTIVE' },
          rule: dueRuleToday(),
          fee_structure_ids: [structure.id],
          starts_on: '2026-01-01',
        } as any,
        TENANT_ID,
        SEED_ADMIN_USER_ID,
      );

      await buildScheduler().process({ data: { tenantId: TENANT_ID } } as any);
      const firstRunBills = await studentFeeRepo.find();
      expect(firstRunBills).toHaveLength(1);
      const firstBillId = firstRunBills[0].id;

      await programEnrollmentRepo.update(
        { student_id: student.id, program_id: program.id },
        { status: ProgramEnrollmentStatus.WITHDRAWN, ended_on: '2026-02-01' },
      );
      // Swap in a second fee structure for the re-run: DuplicateStrategy.SKIP
      // would silently suppress a second bill against the *same* structure
      // regardless of whether the WITHDRAWN filter works, making this
      // assertion pass even if `pe.status = ACTIVE` were dropped from
      // `applyProgramAudience`. A distinct structure means "no new bill" can
      // only happen because the audience query actually excluded the student.
      const structure2 = await structureRepo.save(makeStructure());
      await dataSource.query(
        `UPDATE recurring_schedule_structures SET fee_structure_id = $1 WHERE schedule_id = $2`,
        [structure2.id, schedule.id],
      );
      // Force a re-run for a later period: reset last_run_period so the
      // scheduler's idempotency check doesn't skip a same-day sweep.
      await dataSource.query(
        `UPDATE recurring_schedules SET last_run_period = NULL WHERE id = $1`,
        [schedule.id],
      );

      await buildScheduler().process({ data: { tenantId: TENANT_ID } } as any);

      const billsAfter = await studentFeeRepo.find();
      // No new bill for the now-WITHDRAWN student; the first bill stands.
      expect(billsAfter.map((b) => b.id)).toEqual([firstBillId]);
    });

    it('skips a student with an ACTIVE program enrolment but no ACTIVE class enrollment (D17: class-enrollment-in-year condition is not relaxed for program audiences)', async () => {
      const structure = await structureRepo.save(makeStructure());
      // `enrollment_status: INACTIVE` — no longer counts as an ACTIVE class
      // enrollment, even though `class_section_id` (a required column) is
      // still set to some section.
      const noActiveClassEnrollment = await studentRepo.save(
        makeStudent({ enrollment_status: 'INACTIVE' } as Partial<Student>),
      );
      const program = await enrollInNewProgram(noActiveClassEnrollment.id);

      await recurringSchedulesService.create(
        {
          academic_year_id: SEED_ACADEMIC_YEAR_ID,
          name: `Program schedule ${Date.now()}`,
          audience: { program_id: program.id, enrollment_status: 'ACTIVE' },
          rule: dueRuleToday(),
          fee_structure_ids: [structure.id],
          starts_on: '2026-01-01',
        } as any,
        TENANT_ID,
        SEED_ADMIN_USER_ID,
      );

      await buildScheduler().process({ data: { tenantId: TENANT_ID } } as any);

      const bills = await studentFeeRepo.find();
      expect(bills).toHaveLength(0);
    });

    it('program + section combined intersects — only students in both are billed', async () => {
      const structure = await structureRepo.save(makeStructure());
      const inBoth = await studentRepo.save(makeStudent({ class_section_id: SEED_SECTION_1_ID }));
      const programOnlyOtherSection = await studentRepo.save(
        makeStudent({ class_section_id: SEED_SECTION_2_ID }),
      );
      const program = await enrollInNewProgram(inBoth.id);
      await programEnrollmentRepo.save(
        programEnrollmentRepo.create({
          tenant_id: TENANT_ID,
          program_id: program.id,
          student_id: programOnlyOtherSection.id,
          started_on: '2026-01-01',
          status: ProgramEnrollmentStatus.ACTIVE,
        }),
      );

      await recurringSchedulesService.create(
        {
          academic_year_id: SEED_ACADEMIC_YEAR_ID,
          name: `Program+section schedule ${Date.now()}`,
          audience: {
            section_id: SEED_SECTION_1_ID,
            program_id: program.id,
            enrollment_status: 'ACTIVE',
          },
          rule: dueRuleToday(),
          fee_structure_ids: [structure.id],
          starts_on: '2026-01-01',
        } as any,
        TENANT_ID,
        SEED_ADMIN_USER_ID,
      );

      await buildScheduler().process({ data: { tenantId: TENANT_ID } } as any);

      const bills = await studentFeeRepo.find();
      expect(bills).toHaveLength(1);
      expect(bills[0].student_id).toBe(inBoth.id);
    });
  });
});

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { BullModule } from '@nestjs/bullmq';
import { ConfigModule } from '@nestjs/config';
import { DataSource } from 'typeorm';
import { UserRole } from '@biddaloy/shared';
import { ALL_ENTITIES } from '@test/all-entities';
import { createTestModule } from '@test/helpers/module.helper';
import { AuthModule } from '../../../auth/auth.module';
import { TenantStatusModule } from '../../../schools/tenant-status.module';
import { DEFAULT_TENANT_SETTINGS } from '../../../schools/settings/tenant-settings-defaults';
import { AlertWriterService } from '../../engine/alert-writer.service';
import type { AttentionRule, RuleContext } from '../rule.types';
import { FeesOverdueRisingRule } from './fees-overdue-rising.rule';
import { FeesRemindersPendingRule } from './fees-reminders-pending.rule';
import { FeesStructureMissingNewYearRule } from './fees-structure-missing-new-year.rule';
import { FeesUnassignedStudentsRule } from './fees-unassigned-students.rule';
import { FeesRulesModule } from './fees-rules.module';

// 2043-03-10 10:00 in Dhaka. Current year is 2043; the next one starts 30 days later.
const DAY = '2043-03-10';
const NOW = new Date(`${DAY}T04:00:00Z`);
let roll = 0; // roll numbers are unique per section
const rand = () => Math.random().toString(36).slice(2, 9);

describe('Fees rules (integration)', () => {
  let ds: DataSource;
  let writer: AlertWriterService;
  let overdue: FeesOverdueRisingRule;
  let reminders: FeesRemindersPendingRule;
  let unassigned: FeesUnassignedStudentsRule;
  let structureMissing: FeesStructureMissingNewYearRule;

  interface Tenant {
    id: string;
    accountantId: string;
    adminId: string;
    yearId: string;
    nextYearId: string;
    structureId: string;
    sectionId: string;
  }
  let A: Tenant;
  let B: Tenant;

  const ctx = (t: Tenant): RuleContext => ({
    tenantId: t.id,
    now: NOW,
    tz: 'Asia/Dhaka',
    localDate: DAY,
    localTime: '10:00',
    isWorkingDay: true,
    settings: { ...DEFAULT_TENANT_SETTINGS.attention! },
  });

  const mkUser = async (tenantId: string, role: UserRole) => {
    const [{ id }] = await ds.query(
      `INSERT INTO users (email, password_hash, full_name, status, created_at, updated_at)
       VALUES ($1, 'x', 'Fees Test', 'ACTIVE', NOW(), NOW()) RETURNING id`,
      [`fees-${rand()}@example.com`],
    );
    await ds.query(
      `INSERT INTO user_tenants (user_id, tenant_id, role, created_at, updated_at)
       VALUES ($1, $2, $3, NOW(), NOW())`,
      [id, tenantId, role],
    );
    return id as string;
  };

  // Every test builds fresh tenants: the harness wipes students, fees and structures between tests.
  async function mkTenant(withNextYearStructure = false): Promise<Tenant> {
    const [{ id }] = await ds.query(
      `INSERT INTO schools (name, slug) VALUES ('Fees Test', $1) RETURNING id`,
      [`fees-${rand()}`],
    );
    const accountantId = await mkUser(id, UserRole.ACCOUNTANT);
    const adminId = await mkUser(id, UserRole.ADMIN);
    const [{ id: yearId }] = await ds.query(
      `INSERT INTO academic_years (name, start_date, end_date, is_current, tenant_id)
       VALUES ('2043', '2043-01-01', '2043-12-31', true, $1) RETURNING id`,
      [id],
    );
    const [{ id: nextYearId }] = await ds.query(
      `INSERT INTO academic_years (name, start_date, end_date, is_current, tenant_id)
       VALUES ('2044', '2043-04-09', '2044-03-31', false, $1) RETURNING id`,
      [id],
    );
    const [{ id: classId }] = await ds.query(
      `INSERT INTO classes (name, academic_year_id, tenant_id) VALUES ('Six', $1, $2) RETURNING id`,
      [yearId, id],
    );
    const [{ id: sectionId }] = await ds.query(
      `INSERT INTO class_sections (class_id, section_name, tenant_id) VALUES ($1, 'A', $2) RETURNING id`,
      [classId, id],
    );
    const structure = (year: string) =>
      ds.query(
        `INSERT INTO fee_structures (fee_type, name, amount, academic_year_id, tenant_id)
         VALUES ('MONTHLY_TUITION', 'Tuition', 1000, $1, $2) RETURNING id`,
        [year, id],
      );
    const [{ id: structureId }] = await structure(yearId);
    if (withNextYearStructure) await structure(nextYearId);
    return { id, accountantId, adminId, yearId, nextYearId, structureId, sectionId };
  }

  const mkStudent = async (t: Tenant) =>
    (
      await ds.query(
        `INSERT INTO students (full_name, registration_number, roll_number, class_section_id, tenant_id, enrollment_status)
         VALUES ('Fees Kid', $1, $4, $2, $3, 'ACTIVE') RETURNING id`,
        [`REG-${rand()}`, t.sectionId, t.id, ++roll],
      )
    )[0].id as string;

  const mkFee = async (
    t: Tenant,
    studentId: string,
    o: { due?: string; threshold?: string; status?: string; total?: number; period?: string } = {},
  ) =>
    (
      await ds.query(
        `INSERT INTO student_fees (student_id, academic_year_id, fee_structure_id, period_start, period_type,
           total_amount, status, due_date, reminder_threshold_date)
         VALUES ($1, $2, $3, $4, 'MONTH', $5, $6, $7, $8) RETURNING id`,
        [
          studentId,
          t.yearId,
          t.structureId,
          o.period ?? '2043-03-01',
          o.total ?? 1000,
          o.status ?? 'PENDING',
          o.due ?? null,
          o.threshold ?? null,
        ],
      )
    )[0].id as string;

  const mkReminderLog = (t: Tenant, studentId: string, createdAt: string, trigger: string) =>
    ds.query(
      `INSERT INTO communication_logs (medium, recipient_address, recipient_name, message_body, trigger, student_id, tenant_id, created_at, updated_at)
       VALUES ('SMS', '01700000000', 'x', 'x', $4, $1, $2, $3::timestamptz, $3::timestamptz)`,
      [studentId, t.id, createdAt, trigger],
    );

  const run = async (rule: AttentionRule, t: Tenant) => {
    const c = ctx(t);
    return writer.apply(c, rule, await rule.evaluate(c));
  };
  const alertStatus = async (t: Tenant, ruleKey: string) =>
    (
      await ds.query(`SELECT status FROM alerts WHERE tenant_id = $1 AND rule_key = $2`, [
        t.id,
        ruleKey,
      ])
    ).map((r: { status: string }) => r.status);

  beforeAll(async () => {
    const module = await createTestModule(
      ALL_ENTITIES,
      [AlertWriterService],
      [
        ConfigModule.forRoot({ isGlobal: true }),
        // TenantStatusModule reaches Bull queues and the @Global AuthModule; AppModule normally supplies both.
        BullModule.forRoot({ connection: { url: process.env.REDIS_URL } }),
        AuthModule,
        TenantStatusModule,
        FeesRulesModule,
      ],
    );
    ds = module.get(DataSource);
    writer = module.get(AlertWriterService);
    overdue = module.get(FeesOverdueRisingRule, { strict: false });
    reminders = module.get(FeesRemindersPendingRule, { strict: false });
    unassigned = module.get(FeesUnassignedStudentsRule, { strict: false });
    structureMissing = module.get(FeesStructureMissingNewYearRule, { strict: false });
  }, 60000);

  afterAll(async () => {
    await ds.destroy();
  });

  beforeEach(async () => {
    A = await mkTenant();
    B = await mkTenant();
  });

  it('overdue_rising: counts open fees that fell due in the last 7 days, to ACCOUNTANT only', async () => {
    const s = await mkStudent(A);
    await mkFee(A, s, { due: '2043-03-07', total: 700 }); // 3 days ago: counts
    await mkFee(A, s, { due: '2043-02-20', total: 900, period: '2043-02-01' }); // older: no
    await mkFee(A, s, { due: '2043-03-08', total: 500, status: 'PAID', period: '2043-04-01' }); // paid: no
    const [f] = await overdue.evaluate(ctx(A));
    expect(f.params).toEqual({ count: 1, students: 1, amount: 700 });
    expect(f.recipients).toEqual([{ userId: A.accountantId, role: UserRole.ACCOUNTANT }]);
  });

  it("overdue_rising: tenant B's bigger overdue fees never change A, and B's staff are never recipients", async () => {
    const sa = await mkStudent(A);
    const sb = await mkStudent(B);
    await mkFee(A, sa, { due: '2043-03-07', total: 700 });
    await mkFee(B, sb, { due: '2043-03-07', total: 99000 });
    const [fa] = await overdue.evaluate(ctx(A));
    expect(fa.params).toMatchObject({ count: 1, amount: 700 });
    expect(fa.recipients.map((r) => r.userId)).not.toContain(B.accountantId);
    const [fb] = await overdue.evaluate(ctx(B));
    expect(fb.params).toMatchObject({ count: 1, amount: 99000 });
  });

  it('overdue_rising: ACTIVE, then RESOLVED once the fee is paid', async () => {
    const s = await mkStudent(A);
    const fee = await mkFee(A, s, { due: '2043-03-07' });
    await run(overdue, A);
    expect(await alertStatus(A, 'fees.overdue_rising')).toEqual(['ACTIVE']);
    await ds.query(`UPDATE student_fees SET status = 'PAID' WHERE id = $1`, [fee]);
    await run(overdue, A);
    expect(await alertStatus(A, 'fees.overdue_rising')).toEqual(['RESOLVED']);
  });

  it('reminders_pending: flagged fee with no recent reminder fires; a reminder 2 days ago silences it', async () => {
    const s = await mkStudent(A);
    await mkFee(A, s, { threshold: '2043-03-01' });
    const [f] = await reminders.evaluate(ctx(A));
    expect(f.params).toEqual({ students: 1 });
    expect(await reminders.evaluate(ctx(B))).toEqual([]);

    await mkReminderLog(A, s, '2043-03-08T04:00:00Z', 'SINGLE_REMINDER');
    expect(await reminders.evaluate(ctx(A))).toEqual([]);
  });

  it('reminders_pending: a reminder older than 7 days does not silence it; a paid fee does not fire', async () => {
    const s = await mkStudent(A);
    const fee = await mkFee(A, s, { threshold: '2043-03-01' });
    await mkReminderLog(A, s, '2043-03-01T04:00:00Z', 'BULK_REMINDER');
    expect(await reminders.evaluate(ctx(A))).toHaveLength(1);
    await ds.query(`UPDATE student_fees SET status = 'PAID' WHERE id = $1`, [fee]);
    expect(await reminders.evaluate(ctx(A))).toEqual([]);
  });

  it('unassigned_students: this month fee for 1 of 2 students fires; both covered resolves; none generated is silent', async () => {
    const s1 = await mkStudent(A);
    const s2 = await mkStudent(A);
    expect(await unassigned.evaluate(ctx(A))).toEqual([]); // nothing generated yet
    await mkFee(A, s1, { period: '2043-03-01' });
    const [f] = await unassigned.evaluate(ctx(A));
    expect(f.params).toEqual({ missing: 1, month: '2043-03' });
    expect(f.dedupeKey).toBe(`school:${A.id}:2043-03`);
    expect(f.recipients.map((r) => r.role).sort()).toEqual([UserRole.ACCOUNTANT, UserRole.ADMIN]);
    // B has students without fees but nothing generated: stays silent, and A's fee never counts for B.
    await mkStudent(B);
    expect(await unassigned.evaluate(ctx(B))).toEqual([]);

    await run(unassigned, A);
    expect(await alertStatus(A, 'fees.unassigned_students')).toEqual(['ACTIVE']);
    await mkFee(A, s2, { period: '2043-03-01' });
    await run(unassigned, A);
    expect(await alertStatus(A, 'fees.unassigned_students')).toEqual(['RESOLVED']);
  });

  it('unassigned_students: a fine or other non-tuition bill this month is not a tuition run, so it stays silent', async () => {
    const s1 = await mkStudent(A);
    await mkStudent(A);
    // FinesService.logFine bills one student a MONTH-period fee for the incident month.
    for (const feeType of ['FINE', 'OTHER']) {
      const [{ id: structureId }] = await ds.query(
        `INSERT INTO fee_structures (fee_type, name, amount, academic_year_id, tenant_id)
         VALUES ($1, $2, 200, $3, $4) RETURNING id`,
        [feeType, `${feeType} fee`, A.yearId, A.id],
      );
      await ds.query(
        `INSERT INTO student_fees (student_id, academic_year_id, fee_structure_id, period_start, period_type, total_amount, status)
         VALUES ($1, $2, $3, '2043-03-01', 'MONTH', 200, 'PENDING')`,
        [s1, A.yearId, structureId],
      );
    }
    expect(await unassigned.evaluate(ctx(A))).toEqual([]);
  });

  it('unassigned_students: a student excluded from the tuition schedule is left out on purpose, so it stays silent', async () => {
    const s1 = await mkStudent(A);
    const exempt = await mkStudent(A);
    await mkFee(A, s1, { period: '2043-03-01' });
    expect((await unassigned.evaluate(ctx(A)))[0].params).toEqual({ missing: 1, month: '2043-03' });

    const [{ id: scheduleId }] = await ds.query(
      `INSERT INTO recurring_schedules (tenant_id, academic_year_id, name, audience, rule, period_type, starts_on, ends_on)
       VALUES ($1, $2, 'Tuition', '{"enrollment_status":"ACTIVE"}', '{"kind":"MONTHLY","day_of_month":1}', 'MONTH',
               '2043-01-01', '2043-12-31') RETURNING id`,
      [A.id, A.yearId],
    );
    await ds.query(
      `INSERT INTO recurring_schedule_structures (schedule_id, fee_structure_id) VALUES ($1, $2)`,
      [scheduleId, A.structureId],
    );
    await ds.query(
      `INSERT INTO recurring_schedule_exclusions (schedule_id, student_id, reason) VALUES ($1, $2, 'Free studentship')`,
      [scheduleId, exempt],
    );
    expect(await unassigned.evaluate(ctx(A))).toEqual([]);
  });

  it('unassigned_students: a section no tuition run billed (outside every schedule) stays silent', async () => {
    const s1 = await mkStudent(A);
    await mkFee(A, s1, { period: '2043-03-01' });
    // Play group: same year, no tuition schedule covers it.
    const [{ id: classId }] = await ds.query(
      `INSERT INTO classes (name, academic_year_id, tenant_id) VALUES ('Play', $1, $2) RETURNING id`,
      [A.yearId, A.id],
    );
    const [{ id: sectionId }] = await ds.query(
      `INSERT INTO class_sections (class_id, section_name, tenant_id) VALUES ($1, 'A', $2) RETURNING id`,
      [classId, A.id],
    );
    await mkStudent({ ...A, sectionId });
    expect(await unassigned.evaluate(ctx(A))).toEqual([]);
  });

  it('structure_missing_new_year: next year in 30 days with no structure fires to both roles; a structure silences it', async () => {
    const [f] = await structureMissing.evaluate(ctx(A));
    expect(f.params).toEqual({ year: '2044', startDate: '2043-04-09' });
    expect(f.dedupeKey).toBe(`academic_year:${A.nextYearId}`);
    expect(f.recipients.map((r) => r.userId).sort()).toEqual([A.accountantId, A.adminId].sort());

    await run(structureMissing, A);
    expect(await alertStatus(A, 'fees.structure_missing_new_year')).toEqual(['ACTIVE']);
    // B's structure for its own next year never covers A's.
    await ds.query(
      `INSERT INTO fee_structures (fee_type, name, amount, academic_year_id, tenant_id)
       VALUES ('MONTHLY_TUITION', 'Tuition', 1000, $1, $2)`,
      [B.nextYearId, B.id],
    );
    expect(await structureMissing.evaluate(ctx(A))).toHaveLength(1);
    expect(await structureMissing.evaluate(ctx(B))).toEqual([]);

    await ds.query(
      `INSERT INTO fee_structures (fee_type, name, amount, academic_year_id, tenant_id)
       VALUES ('MONTHLY_TUITION', 'Tuition', 1000, $1, $2)`,
      [A.nextYearId, A.id],
    );
    await run(structureMissing, A);
    expect(await alertStatus(A, 'fees.structure_missing_new_year')).toEqual(['RESOLVED']);
  });

  it('structure_missing_new_year: a next year more than 60 days away is silent', async () => {
    await ds.query(`UPDATE academic_years SET start_date = '2043-06-01' WHERE id = $1`, [
      A.nextYearId,
    ]);
    expect(await structureMissing.evaluate(ctx(A))).toEqual([]);
  });
});

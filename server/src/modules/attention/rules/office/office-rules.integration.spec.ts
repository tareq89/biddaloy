import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { ConfigModule } from '@nestjs/config';
import { DataSource } from 'typeorm';
import { ALL_ENTITIES } from '@test/all-entities';
import { createTestModule } from '@test/helpers/module.helper';
import { UserRole } from '@biddaloy/shared';
import { AuthModule } from '../../../auth/auth.module';
import { LeaveModule } from '../../../leave/leave.module';
import { LeaveService } from '../../../leave/leave.service';
import { attentionEvents } from '../../attention.constants';
import { ATTENTION_RECHECK, AttentionRecheckPayload } from '../../engine/attention-events';
import { AlertWriterService } from '../../engine/alert-writer.service';
import type { RuleContext } from '../rule.types';
import { AcrIncompleteRule } from './acr-incomplete.rule';
import { AdmissionApplicationsPendingRule } from './admission-applications-pending.rule';
import { AdmissionIntakeWindowRule } from './admission-intake-window.rule';
import { LeaveMyRequestDecidedRule } from './leave-my-request-decided.rule';
import { LeaveStaffPendingRule } from './leave-staff-pending.rule';
import { StudentsRecordsIncompleteRule } from './students-records-incomplete.rule';
import { OfficeRulesModule } from './office-rules.module';

const NOW = new Date('2043-03-02T04:00:00Z');
const DAY = '2043-03-02';
const CONTEXT = { ip: null, userAgent: null };

describe('Office rules (integration)', () => {
  let ds: DataSource;
  let writer: AlertWriterService;
  let leave: LeaveService;
  let applications: AdmissionApplicationsPendingRule;
  let intakeWindow: AdmissionIntakeWindowRule;
  let records: StudentsRecordsIncompleteRule;
  let staffPending: LeaveStaffPendingRule;
  let myDecided: LeaveMyRequestDecidedRule;
  let acr: AcrIncompleteRule;

  interface Tenant {
    id: string;
    adminId: string;
    execId: string;
    officeId: string;
    teacherId: string;
    yearId: string;
    sectionId: string;
  }
  let A: Tenant;
  let B: Tenant;

  const rand = () => Math.random().toString(36).slice(2, 9);
  const ctx = (t: Tenant, extra: Partial<RuleContext> = {}): RuleContext => ({
    tenantId: t.id,
    now: NOW,
    tz: 'Asia/Dhaka',
    localDate: DAY,
    localTime: '10:00',
    isWorkingDay: true,
    settings: {} as RuleContext['settings'],
    ...extra,
  });
  const ids = (xs: { recipients: { userId: string }[] }[]) =>
    xs.flatMap((x) => x.recipients.map((r) => r.userId)).sort();

  async function mkUser(tenantId: string, role: UserRole): Promise<string> {
    const [{ id }] = await ds.query(
      `INSERT INTO users (email, password_hash, full_name, status, created_at, updated_at)
       VALUES ($1, 'x', 'Office Test', 'ACTIVE', NOW(), NOW()) RETURNING id`,
      [`office-${rand()}@example.com`],
    );
    await ds.query(`INSERT INTO user_tenants (user_id, tenant_id, role) VALUES ($1, $2, $3)`, [
      id,
      tenantId,
      role,
    ]);
    return id;
  }

  async function mkTenant(): Promise<Tenant> {
    const [{ id }] = await ds.query(
      `INSERT INTO schools (name, slug) VALUES ('Office Test', $1) RETURNING id`,
      [`office-${rand()}`],
    );
    const [{ id: yearId }] = await ds.query(
      `INSERT INTO academic_years (name, start_date, end_date, is_current, tenant_id)
       VALUES ('2043', '2043-01-01', '2043-12-31', true, $1) RETURNING id`,
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
    return {
      id,
      yearId,
      sectionId,
      adminId: await mkUser(id, UserRole.ADMIN),
      execId: await mkUser(id, UserRole.EXECUTIVE),
      officeId: await mkUser(id, UserRole.OFFICE_STAFF),
      teacherId: await mkUser(id, UserRole.TEACHER),
    };
  }

  async function mkIntake(t: Tenant, openOffsetDays: number, closeOffsetDays: number) {
    const day = (n: number) =>
      new Date(Date.parse(`${DAY}T00:00:00Z`) + n * 86400000).toISOString().slice(0, 10);
    const [{ id }] = await ds.query(
      `INSERT INTO admission_intakes (tenant_id, class_section_id, title, seat_count, open_date, close_date)
       VALUES ($1, $2, 'Intake', 30, $3, $4) RETURNING id`,
      [t.id, t.sectionId, day(openOffsetDays), day(closeOffsetDays)],
    );
    return id as string;
  }

  async function mkApplicant(t: Tenant, intakeId: string, status: string) {
    await ds.query(
      `INSERT INTO admission_applicants (tenant_id, intake_id, reference_number, applicant_name,
         date_of_birth, gender, guardian_name, guardian_phone, status)
       VALUES ($1, $2, $3, 'Kid', '2035-01-01', 'MALE', 'Parent', $4, $5)`,
      [t.id, intakeId, `REF-${rand()}`, `017${Math.floor(Math.random() * 1e8)}`, status],
    );
  }

  /** A staff member (user + staff profile) with one leave record in `status`. */
  async function mkLeave(t: Tenant, status: string, decidedAt: Date | null = null) {
    const userId = await mkUser(t.id, UserRole.TEACHER);
    const [{ id: profileId }] = await ds.query(
      `INSERT INTO staff_profiles (id, user_id, tenant_id, employee_id, created_at, updated_at)
       VALUES (gen_random_uuid(), $1, $2, $3, NOW(), NOW()) RETURNING id`,
      [userId, t.id, `E-${rand()}`],
    );
    const [{ id }] = await ds.query(
      `INSERT INTO leave_records (id, tenant_id, staff_profile_id, leave_type, start_date, end_date, days, status, decided_at)
       VALUES (gen_random_uuid(), $1, $2, 'CASUAL', '2043-03-10', '2043-03-11', 2, $3, $4) RETURNING id`,
      [t.id, profileId, status, decidedAt],
    );
    return { userId, profileId, id: id as string };
  }

  async function mkAcr(t: Tenant, updatedAt: Date) {
    const [{ id: formId }] = await ds.query(
      `INSERT INTO acr_form_versions (tenant_id, version, created_by) VALUES ($1, $3, $2) RETURNING id`,
      [t.id, t.adminId, Math.floor(Math.random() * 1e9)],
    );
    const subjectUser = await mkUser(t.id, UserRole.TEACHER);
    const [{ id }] = await ds.query(
      `INSERT INTO acr_assessments (tenant_id, user_id, academic_year_id, form_version_id, status, assessed_by, created_at, updated_at)
       VALUES ($1, $2, $3, $4, 'INCOMPLETE', $5, $6, $6) RETURNING id`,
      [t.id, subjectUser, t.yearId, formId, t.adminId, updatedAt],
    );
    return { id: id as string, subjectUser };
  }

  beforeAll(async () => {
    const module = await createTestModule(
      ALL_ENTITIES,
      [AlertWriterService],
      [ConfigModule.forRoot({ isGlobal: true }), OfficeRulesModule, LeaveModule, AuthModule],
    );
    ds = module.get(DataSource);
    writer = module.get(AlertWriterService);
    leave = module.get(LeaveService);
    applications = module.get(AdmissionApplicationsPendingRule);
    intakeWindow = module.get(AdmissionIntakeWindowRule);
    records = module.get(StudentsRecordsIncompleteRule);
    staffPending = module.get(LeaveStaffPendingRule);
    myDecided = module.get(LeaveMyRequestDecidedRule);
    acr = module.get(AcrIncompleteRule);
    A = await mkTenant();
    B = await mkTenant();
  }, 60000);

  // The harness wipes most transactional tables between tests; clear what it keeps.
  beforeEach(async () => {
    for (const t of [A, B]) {
      for (const table of [
        'alerts',
        'admission_applicants',
        'admission_intakes',
        'leave_records',
        'acr_assessments',
        'acr_form_versions',
      ]) {
        await ds.query(`DELETE FROM ${table} WHERE tenant_id = $1`, [t.id]);
      }
      await ds.query(`DELETE FROM students WHERE tenant_id = $1`, [t.id]);
    }
  });

  afterAll(async () => {
    await ds.destroy();
  });

  it('admission.applications_pending: PENDING fires for OFFICE_STAFF + ADMIN only; SHORTLISTED and tenant B do not count', async () => {
    const intakeA = await mkIntake(A, -5, 20);
    await mkApplicant(A, intakeA, 'SHORTLISTED');
    expect(await applications.evaluate(ctx(A))).toEqual([]);

    await mkApplicant(A, intakeA, 'PENDING');
    // B has two pending applicants of its own; they must not leak into A's count.
    const intakeB = await mkIntake(B, -5, 20);
    await mkApplicant(B, intakeB, 'PENDING');
    await mkApplicant(B, intakeB, 'PENDING');

    const [f] = await applications.evaluate(ctx(A));
    expect(f.params.count).toBe(1);
    expect(ids([f])).toEqual([A.adminId, A.officeId].sort());
  });

  it('admission.intake_window: closing in 2 days fires, closing in 10 days does not', async () => {
    const soon = await mkIntake(A, -20, 2);
    await mkIntake(A, -20, 10);
    const findings = await intakeWindow.evaluate(ctx(A));
    expect(findings.map((f) => f.dedupeKey)).toEqual([`admission_intake:${soon}`]);
    expect(await intakeWindow.evaluate(ctx(B))).toEqual([]);
  });

  it('students.records_incomplete: counts own ACTIVE students missing a photo', async () => {
    for (const t of [A, B]) {
      await ds.query(
        `INSERT INTO students (full_name, registration_number, roll_number, class_section_id, tenant_id,
           enrollment_status, birth_reg_no, date_of_birth)
         VALUES ('No Photo', $1, 1, $2, $3, 'ACTIVE', $4, '2035-01-01')`,
        [`R-${rand()}`, t.sectionId, t.id, `B-${rand()}`],
      );
    }
    await ds.query(
      `INSERT INTO students (full_name, registration_number, roll_number, class_section_id, tenant_id,
         enrollment_status, birth_reg_no, date_of_birth, photo_key)
       VALUES ('Complete', $1, 2, $2, $3, 'ACTIVE', $4, '2035-01-01', 'k')`,
      [`R-${rand()}`, A.sectionId, A.id, `B-${rand()}`],
    );
    const [f] = await records.evaluate(ctx(A));
    expect(f.params.count).toBe(1);
    expect(ids([f])).toEqual([A.adminId, A.officeId].sort());
  });

  it('leave.staff_pending: PENDING goes to ADMIN + EXECUTIVE, not TEACHER or tenant B', async () => {
    expect(await staffPending.evaluate(ctx(A))).toEqual([]);
    await mkLeave(A, 'PENDING');
    await mkLeave(B, 'PENDING');
    const [f] = await staffPending.evaluate(ctx(A));
    expect(f.params).toEqual({ count: 1, firstStart: '2043-03-10' });
    expect(ids([f])).toEqual([A.adminId, A.execId].sort());
  });

  it('acr.incomplete: stale draft fires to its assessed_by; fresh draft does not', async () => {
    const stale = await mkAcr(A, new Date(NOW.getTime() - 8 * 86400000));
    expect(ids(await acr.evaluate(ctx(A)))).toEqual([A.adminId]);
    const [f] = await acr.evaluate(ctx(A));
    expect(f.actionUrl).toBe(`/staff/${stale.subjectUser}/acr/${stale.id}`);
    expect(await acr.evaluate(ctx(B))).toEqual([]);

    await ds.query(`DELETE FROM acr_assessments WHERE tenant_id = $1`, [A.id]);
    await mkAcr(A, new Date(NOW.getTime() - 86400000));
    expect(await acr.evaluate(ctx(A))).toEqual([]);
  });

  it('personal rules skip a recipient who left this school (account kept for other schools)', async () => {
    // acr.incomplete: an assessor of their own (A.adminId is shared with other tests).
    await mkAcr(A, new Date(NOW.getTime() - 8 * 86400000));
    const assessor = await mkUser(A.id, UserRole.TEACHER);
    await ds.query(`UPDATE acr_assessments SET assessed_by = $2 WHERE tenant_id = $1`, [
      A.id,
      assessor,
    ]);
    expect(ids(await acr.evaluate(ctx(A)))).toEqual([assessor]);
    // leave.my_request_decided: a decision 1 hour ago.
    const decided = await mkLeave(A, 'APPROVED', new Date(NOW.getTime() - 3600_000));
    expect(ids(await myDecided.evaluate(ctx(A)))).toEqual([decided.userId]);

    // Both leave school A. Their users stay ACTIVE (they may work elsewhere).
    await ds.query(
      `UPDATE user_tenants SET deleted_at = NOW() WHERE tenant_id = $1 AND user_id = ANY($2)`,
      [A.id, [assessor, decided.userId]],
    );
    expect(await acr.evaluate(ctx(A))).toEqual([]);
    expect(await myDecided.evaluate(ctx(A))).toEqual([]);
  });
});

import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from 'vitest';
import { ConfigModule } from '@nestjs/config';
import { getDataSourceToken } from '@nestjs/typeorm';
import { randomUUID } from 'node:crypto';
import { DataSource } from 'typeorm';
import { createTestModule } from '@test/helpers/module.helper';
import { ALL_ENTITIES } from '@test/all-entities';
import {
  SEED_ADMIN_PASSWORD_HASH,
  SEED_ADMIN_USER_ID,
  SEED_SECTION_1_ID,
  SEED_TENANT_ID,
} from '@test/constants';
import { ApplicationType, TeacherAssignmentType, UserRole } from '@biddaloy/shared';
import { todayInSchoolTz } from '../../common/time';
import { AuthModule } from '../auth/auth.module';
import { Teacher } from '../academics/entities/teacher.entity';
import { ApplicationsModule } from './applications.module';
import { ApplicationsService } from './applications.service';
import { ApplicationReportsService } from './application-reports.service';
import { ApplicationLetterService } from './application-letter.service';
import { ApplicationNotifyService } from './application-notify.service';
import type { ApplicationCaller } from './reviewer-scope';
import type { CreateApplicationDto } from './dto/application.dto';

/**
 * [52.3.5] `ApplicationReportsService` against the real, migrated test database.
 * Applications are seeded through `ApplicationsService.submit` (letter + notify stubbed), then
 * status and timestamps are set directly so the fixtures are exact.
 */
describe('ApplicationReportsService (integration)', () => {
  let reports: ApplicationReportsService;
  let applications: ApplicationsService;
  let dataSource: DataSource;

  const TENANT_B = randomUUID();
  const ctx = { ip: null, userAgent: null };
  const u = {
    parent: randomUUID(),
    ct: randomUUID(),
    other: randomUUID(),
    office: randomUUID(),
    acct: randomUUID(),
    exec: randomUUID(),
    bAdmin: randomUUID(),
  };
  const callers = {
    parent: { userId: u.parent, role: UserRole.PARENT },
    ct: { userId: u.ct, role: UserRole.TEACHER },
    other: { userId: u.other, role: UserRole.TEACHER },
    office: { userId: u.office, role: UserRole.OFFICE_STAFF },
    acct: { userId: u.acct, role: UserRole.ACCOUNTANT },
    exec: { userId: u.exec, role: UserRole.EXECUTIVE },
    admin: { userId: SEED_ADMIN_USER_ID, role: UserRole.ADMIN },
  } satisfies Record<string, ApplicationCaller>;

  let studentA: string;
  let adminProfile: string;

  beforeAll(async () => {
    const module = await createTestModule(
      ALL_ENTITIES,
      [],
      [ConfigModule.forRoot({ isGlobal: true }), ApplicationsModule, AuthModule],
    );
    reports = module.get(ApplicationReportsService);
    applications = module.get(ApplicationsService);
    dataSource = module.get<DataSource>(getDataSourceToken());
    vi.spyOn(module.get(ApplicationLetterService), 'buildContext').mockResolvedValue({
      locale: 'en',
      date: '2026-10-09',
      school_name: '',
      to_title: '',
      applicant_name: '',
      applicant_relation: '',
      serial: null,
      subject_name: '',
      class_name: null,
      section_name: null,
      roll: null,
      ref_names: {},
      days: null,
    });
    vi.spyOn(module.get(ApplicationLetterService), 'render').mockReturnValue('x');
    const notify = module.get(ApplicationNotifyService);
    vi.spyOn(notify, 'onSubmitted').mockResolvedValue();

    const members: Array<[string, UserRole]> = [
      [u.parent, UserRole.PARENT],
      [u.ct, UserRole.TEACHER],
      [u.other, UserRole.TEACHER],
      [u.office, UserRole.OFFICE_STAFF],
      [u.acct, UserRole.ACCOUNTANT],
      [u.exec, UserRole.EXECUTIVE],
    ];
    for (const [id, role] of [...members, [u.bAdmin, UserRole.ADMIN] as [string, UserRole]]) {
      await dataSource.query(
        `INSERT INTO users (id, email, password_hash, full_name, status, created_at, updated_at)
         VALUES ($1, $2, $3, $4, 'ACTIVE', NOW(), NOW()) ON CONFLICT DO NOTHING`,
        [id, `rep-${id}@test.com`, SEED_ADMIN_PASSWORD_HASH, `Name ${role} ${id.slice(0, 4)}`],
      );
    }
    for (const [id, role] of members) {
      await dataSource.query(
        `INSERT INTO user_tenants (user_id, tenant_id, role, created_at, updated_at)
         VALUES ($1, $2, $3, NOW(), NOW()) ON CONFLICT DO NOTHING`,
        [id, SEED_TENANT_ID, role],
      );
    }
    await dataSource.query(
      `INSERT INTO schools (id, name, slug, created_at, updated_at)
       VALUES ($1, 'Reports Tenant B', $2, NOW(), NOW()) ON CONFLICT DO NOTHING`,
      [TENANT_B, `reports-b-${TENANT_B.slice(0, 8)}`],
    );
    await dataSource.query(
      `INSERT INTO user_tenants (user_id, tenant_id, role, created_at, updated_at)
       VALUES ($1, $2, 'ADMIN', NOW(), NOW()) ON CONFLICT DO NOTHING`,
      [u.bAdmin, TENANT_B],
    );
  }, 90000);

  afterAll(async () => {
    if (dataSource) await dataSource.destroy();
  });

  beforeEach(async () => {
    studentA = (
      await dataSource.query(
        `INSERT INTO students (full_name, registration_number, roll_number, class_section_id, tenant_id,
                               enrollment_status, preferred_communication, created_at, updated_at)
         VALUES ('Nadia Akter', $1, $2, $3, $4, 'ACTIVE', 'SMS', NOW(), NOW()) RETURNING id`,
        [
          `RP-${randomUUID().slice(0, 10)}`,
          Math.floor(Math.random() * 1e6),
          SEED_SECTION_1_ID,
          SEED_TENANT_ID,
        ],
      )
    )[0].id as string;
    const guardian = (
      await dataSource.query(
        `INSERT INTO guardians (full_name, relationship, phone, email, tenant_id, user_id,
                                preferred_communication, is_primary_contact, created_at, updated_at)
         VALUES ('Guardian P', 'FATHER', '+8801700000000', $1, $2, $3, 'SMS', true, NOW(), NOW()) RETURNING id`,
        [`g-${randomUUID()}@test.com`, SEED_TENANT_ID, u.parent],
      )
    )[0].id as string;
    await dataSource.query(
      `INSERT INTO student_guardians (student_id, guardian_id) VALUES ($1, $2)`,
      [studentA, guardian],
    );

    const teacher = await dataSource.getRepository(Teacher).save({
      user_id: u.ct,
      tenant_id: SEED_TENANT_ID,
      employee_id: `RP-${randomUUID().slice(0, 12)}`,
      designations: [],
    });
    await dataSource.query(
      `INSERT INTO teacher_class_sections (teacher_id, section_id, tenant_id, assignment_type, created_at)
       VALUES ($1, $2, $3, $4, NOW())`,
      [teacher.id, SEED_SECTION_1_ID, SEED_TENANT_ID, TeacherAssignmentType.CLASS_TEACHER],
    );
    await dataSource.getRepository(Teacher).save({
      user_id: u.other,
      tenant_id: SEED_TENANT_ID,
      employee_id: `RP-${randomUUID().slice(0, 12)}`,
      designations: [],
    });
    for (const userId of [u.acct, SEED_ADMIN_USER_ID]) {
      const [row] = await dataSource.query(
        `INSERT INTO staff_profiles (user_id, tenant_id, employee_id, created_at, updated_at)
         VALUES ($1, $2, $3, NOW(), NOW()) RETURNING id`,
        [userId, SEED_TENANT_ID, `RP-${randomUUID().slice(0, 12)}`],
      );
      if (userId === SEED_ADMIN_USER_ID) adminProfile = row.id;
    }
  });

  // --- helpers -------------------------------------------------------------

  const submit = (c: ApplicationCaller, dto: CreateApplicationDto) =>
    applications.submit(SEED_TENANT_ID, c, dto, ctx);
  const studentLeave = (start = '2026-10-12', end = '2026-10-14') =>
    submit(callers.parent, {
      type: ApplicationType.STUDENT_LEAVE,
      subject_student_id: studentA,
      payload: { reason_kind: 'SICK', start_date: start, end_date: end, details: 'Fever, rest' },
    });
  /** Filed on behalf of a parent by the office, so the applicant is nobody who decides. */
  const testimonial = () =>
    submit(callers.office, {
      type: ApplicationType.TESTIMONIAL,
      subject_student_id: studentA,
      applicant_name: 'Abdul Karim',
      payload: { purpose: 'Scholarship application' },
    });
  const staffLeave = (c: ApplicationCaller) =>
    submit(c, {
      type: ApplicationType.STAFF_LEAVE,
      payload: {
        leave_type: 'CASUAL',
        start_date: '2026-10-12',
        end_date: '2026-10-13',
        reason: 'Family event',
      },
    });
  const setRow = (id: string, set: string) =>
    dataSource.query(`UPDATE applications SET ${set} WHERE id = $1`, [id]);
  const leaveRecord = (
    start: string,
    end: string,
    days: number,
    type = 'CASUAL',
    status = 'APPROVED',
  ) =>
    dataSource.query(
      `INSERT INTO leave_records (tenant_id, staff_profile_id, leave_type, start_date, end_date, days,
                                 status, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, NOW(), NOW())`,
      [SEED_TENANT_ID, adminProfile, type, start, end, days, status],
    );
  const dayOffset = (n: number) => {
    const d = new Date(`${todayInSchoolTz()}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() + n);
    return d.toISOString().slice(0, 10);
  };

  // --- pending-count -------------------------------------------------------

  describe('pendingCount', () => {
    it('equals the view=inbox total for every caller, and by_type sums to it', async () => {
      await studentLeave();
      await testimonial();
      await staffLeave(callers.ct);

      for (const [name, caller] of Object.entries(callers)) {
        const count = await reports.pendingCount(SEED_TENANT_ID, caller);
        const inbox = await applications.list(SEED_TENANT_ID, caller, { view: 'inbox' });
        expect(count.total, name).toBe(inbox.total);
        expect(
          count.by_type.reduce((s, r) => s + r.count, 0),
          name,
        ).toBe(count.total);
      }
      // The class teacher sees the student leave, so the test is not vacuous.
      expect((await reports.pendingCount(SEED_TENANT_ID, callers.ct)).total).toBeGreaterThan(0);
    });

    it('excludes decided, withdrawn and cancelled rows', async () => {
      const a = await studentLeave();
      const before = await reports.pendingCount(SEED_TENANT_ID, callers.ct);
      for (const status of ['APPROVED', 'REJECTED', 'WITHDRAWN', 'CANCELLED']) {
        await setRow(a.id, `status = '${status}'`);
        expect((await reports.pendingCount(SEED_TENANT_ID, callers.ct)).total, status).toBe(
          before.total - 1,
        );
      }
    });

    it('oldest_pending_at is the oldest open row the caller can decide; empty inbox is zeros', async () => {
      const old = await studentLeave();
      await studentLeave();
      await setRow(old.id, `created_at = NOW() - interval '5 days'`);
      const [{ t }] = await dataSource.query(
        `SELECT created_at AS t FROM applications WHERE id = $1`,
        [old.id],
      );
      const res = await reports.pendingCount(SEED_TENANT_ID, callers.ct);
      expect(res.oldest_pending_at).toBe(new Date(t).toISOString());

      // A teacher with no class sees nothing.
      expect(await reports.pendingCount(SEED_TENANT_ID, callers.other)).toEqual({
        total: 0,
        by_type: [],
        oldest_pending_at: null,
      });
    });
  });

  // --- reports -------------------------------------------------------------

  describe('reports', () => {
    it('empty tenant gives zero counts and empty lists', async () => {
      const res = await reports.reports(TENANT_B, { userId: u.bAdmin, role: UserRole.ADMIN }, {});
      expect(res).toEqual({
        by_type_status: [],
        by_month: [],
        avg_decision_hours: null,
        stale_pending: [],
        on_leave_today: { staff: [], students: [] },
        staff_leave_days: [],
      });
    });

    it('by_type_status, by_month and avg_decision_hours on a fixed fixture', async () => {
      const a = await testimonial();
      const b = await testimonial();
      await testimonial();
      await setRow(
        a.id,
        `status = 'APPROVED', created_at = NOW() - interval '10 hours', decided_at = NOW()`,
      );
      await setRow(
        b.id,
        `status = 'REJECTED', created_at = NOW() - interval '20 hours', decided_at = NOW()`,
      );

      const res = await reports.reports(SEED_TENANT_ID, callers.admin, {});
      const count = (status: string) =>
        res.by_type_status.find(
          (r) => r.type === ApplicationType.TESTIMONIAL && r.status === status,
        )?.count;
      expect(count('APPROVED')).toBe(1);
      expect(count('REJECTED')).toBe(1);
      expect(count('PENDING')).toBe(1);
      expect(res.avg_decision_hours).toBe(15);
      const submitted = res.by_month.reduce((s, m) => s + m.submitted, 0);
      expect(submitted).toBe(3);
      expect(res.by_month.reduce((s, m) => s + m.approved, 0)).toBe(1);
      expect(res.by_month.reduce((s, m) => s + m.rejected, 0)).toBe(1);

      // A range in the past excludes today's rows.
      const old = await reports.reports(SEED_TENANT_ID, callers.admin, {
        from: '2020-01-01',
        to: '2020-12-31',
      });
      expect(old.by_type_status).toEqual([]);
    });

    it('from/to match by school-timezone day, like by_month', async () => {
      const a = await testimonial();
      // 20:00 UTC on 2026-03-31 is 02:00 on 2026-04-01 in Asia/Dhaka (+06).
      await setRow(a.id, `created_at = '2026-03-31T20:00:00Z'`);
      const inApril = await reports.reports(SEED_TENANT_ID, callers.admin, {
        from: '2026-04-01',
        to: '2026-04-01',
      });
      expect(inApril.by_month).toEqual([
        { month: '2026-04', submitted: 1, approved: 0, rejected: 0 },
      ]);
      const inMarch = await reports.reports(SEED_TENANT_ID, callers.admin, { to: '2026-03-31' });
      expect(inMarch.by_month).toEqual([]);
    });

    it('stale_pending lists a 4-day-old open row, not a 2-day-old one', async () => {
      const stale = await testimonial();
      const fresh = await testimonial();
      await setRow(stale.id, `created_at = NOW() - interval '4 days'`);
      await setRow(fresh.id, `created_at = NOW() - interval '2 days'`);

      const res = await reports.reports(SEED_TENANT_ID, callers.admin, {});
      expect(res.stale_pending.map((r) => r.id)).toEqual([stale.id]);
      // Paper application: no applicant user, so the typed name is used (D46); serial is Latin.
      expect(res.stale_pending[0].applicant_name).toBe('Abdul Karim');
      expect(res.stale_pending[0].serial).toMatch(/^\d{4}\/\d{4}$/);
    });

    it('on_leave_today lists covering staff and student leave, not past or cancelled ones', async () => {
      await leaveRecord(dayOffset(-1), dayOffset(1), 3, 'SICK');
      const ended = await leaveRecord(dayOffset(-5), dayOffset(-1), 5);
      void ended;
      await leaveRecord(dayOffset(-1), dayOffset(1), 3, 'CASUAL', 'CANCELLED');
      const a = await studentLeave(dayOffset(-1), dayOffset(1));
      const cancelled = await studentLeave(dayOffset(-1), dayOffset(1));
      await setRow(a.id, `status = 'APPROVED'`);
      await setRow(cancelled.id, `status = 'CANCELLED'`);

      const res = await reports.reports(SEED_TENANT_ID, callers.admin, {});
      expect(res.on_leave_today.staff).toHaveLength(1);
      expect(res.on_leave_today.staff[0]).toMatchObject({
        staff_profile_id: adminProfile,
        leave_type: 'SICK',
        end_date: dayOffset(1),
      });
      expect(res.on_leave_today.students).toHaveLength(1);
      expect(res.on_leave_today.students[0]).toMatchObject({
        student_id: studentA,
        name: 'Nadia Akter',
        end_date: dayOffset(1),
      });
    });

    it('staff_leave_days sums per type and month inside [from, to]', async () => {
      await leaveRecord('2026-09-02', '2026-09-04', 3, 'CASUAL');
      await leaveRecord('2026-09-20', '2026-09-21', 2, 'SICK');
      await leaveRecord('2026-10-05', '2026-10-05', 1, 'CASUAL');
      await leaveRecord('2025-01-05', '2025-01-05', 1, 'CASUAL'); // outside the range
      await leaveRecord('2026-09-10', '2026-09-10', 1, 'CASUAL', 'PENDING'); // not approved

      const res = await reports.reports(SEED_TENANT_ID, callers.admin, {
        from: '2026-09-01',
        to: '2026-12-31',
      });
      expect(res.staff_leave_days).toHaveLength(1);
      expect(res.staff_leave_days[0]).toMatchObject({
        staff_profile_id: adminProfile,
        by_type: { CASUAL: 4, SICK: 2 },
        by_month: { '2026-09': 5, '2026-10': 1 },
      });
    });

    it('tenant isolation: tenant A rows never appear for tenant B', async () => {
      const a = await studentLeave(dayOffset(-1), dayOffset(1));
      await setRow(a.id, `status = 'APPROVED', created_at = NOW() - interval '5 days'`);
      await testimonial();
      await leaveRecord(dayOffset(-1), dayOffset(1), 3);

      const bAdmin: ApplicationCaller = { userId: u.bAdmin, role: UserRole.ADMIN };
      expect((await reports.pendingCount(TENANT_B, bAdmin)).total).toBe(0);
      const res = await reports.reports(TENANT_B, bAdmin, {});
      expect(res.by_type_status).toEqual([]);
      expect(res.stale_pending).toEqual([]);
      expect(res.on_leave_today).toEqual({ staff: [], students: [] });
      expect(res.staff_leave_days).toEqual([]);
      // And A really has data, so the checks above are not vacuous.
      expect(
        (await reports.reports(SEED_TENANT_ID, callers.admin, {})).by_type_status.length,
      ).toBeGreaterThan(0);
    });
  });
});

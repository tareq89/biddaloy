import { randomUUID } from 'crypto';
import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { DataSource } from 'typeorm';
import { getDataSourceToken } from '@nestjs/typeorm';
import { createTestModule } from '@test/helpers/module.helper';
import { ALL_ENTITIES } from '@test/all-entities';
import { SEED_ACADEMIC_YEAR_ID, SEED_ADMIN_USER_ID, SEED_TENANT_ID } from '@test/constants';
import { AttendanceService } from './attendance.service';
import { AttendanceModule } from './attendance.module';
import { AuthModule } from '../auth/auth.module';
import { School } from '../schools/entities/school.entity';
import { AcademicYear } from '../academics/entities/academic-year.entity';
import { Class } from '../academics/entities/class.entity';
import { ClassSection } from '../academics/entities/class-section.entity';
import { Student } from '../students/entities/student.entity';
import { Teacher } from '../academics/entities/teacher.entity';
import { TeacherClassSection } from '../academics/entities/teacher-class-section.entity';
import { User } from '../users/entities/user.entity';
import { AttendanceSession } from './entities/attendance-session.entity';
import { AttendanceRecord } from './entities/attendance-record.entity';
import { AuditLog } from '../audit/entities/audit-log.entity';
import { CalendarEvent } from '../calendar/entities/calendar-event.entity';
import { CalendarEventClass } from '../calendar/entities/calendar-event-class.entity';
import { CommunicationLog } from '../communications/entities/communication-log.entity';
import { ReminderBatch } from '../communications/entities/reminder-batch.entity';
import { AttendanceSessionState, AttendanceStatus, UserRole } from '@biddaloy/shared';

/**
 * `AttendanceService.putRegisterMatrix` — many days of one section's
 * whole-day register, all-or-nothing. Real database. Day dates are fixed days
 * of March 2026 (all past, all one month, Mon-Wed) so nothing depends on the
 * calendar moving; ADMIN holds ATTENDANCE_CORRECT, TEACHER does not.
 */
describe('AttendanceService.putRegisterMatrix (integration)', () => {
  let service: AttendanceService;
  let dataSource: DataSource;

  const TENANT_ID = SEED_TENANT_ID;
  const OTHER_TENANT = '00000000-0000-4000-8000-000000000099';
  const ADMIN_USER_ID = SEED_ADMIN_USER_ID;
  const D1 = '2026-03-02';
  const D2 = '2026-03-03';
  const D3 = '2026-03-04';

  let sectionId: string;
  let classId: string;
  let otherTenantSectionId: string;
  let studentId1: string;
  let studentId2: string;
  let teacherUserId: string;

  function today(): string {
    return new Date().toISOString().slice(0, 10);
  }

  async function setSettings(extra: Record<string, unknown> = {}) {
    await dataSource.getRepository(School).update(
      { id: TENANT_ID },
      {
        settings: {
          version: 1,
          attendance: { weeklyOffDays: [], correctionWindowDays: 2, ...extra },
        } as any,
      },
    );
  }

  beforeAll(async () => {
    const module = await createTestModule(
      ALL_ENTITIES,
      [],
      [ConfigModule.forRoot({ isGlobal: true }), AttendanceModule, AuthModule],
    );
    service = module.get(AttendanceService);
    dataSource = module.get<DataSource>(getDataSourceToken());

    const schoolRepo = dataSource.getRepository(School);
    if (!(await schoolRepo.findOne({ where: { id: OTHER_TENANT } }))) {
      await schoolRepo.save({ id: OTHER_TENANT, name: 'Other School', slug: 'other-school' });
    }
    const yearRepo = dataSource.getRepository(AcademicYear);
    const classRepo = dataSource.getRepository(Class);
    const sectionRepo = dataSource.getRepository(ClassSection);

    const year = await yearRepo.save({
      name: 'Matrix Save Test Year',
      start_date: '2026-01-01',
      end_date: '2026-12-31',
      tenant_id: TENANT_ID,
    });
    const klass = await classRepo.save({
      name: 'Matrix Test Class',
      academic_year_id: year.id,
      tenant_id: TENANT_ID,
    });
    classId = klass.id;
    sectionId = (
      await sectionRepo.save({
        section_name: 'Mx Section',
        class_id: klass.id,
        tenant_id: TENANT_ID,
      })
    ).id;

    const otherYear = await yearRepo.save({
      name: 'Matrix Other Tenant Year',
      start_date: '2026-01-01',
      end_date: '2026-12-31',
      tenant_id: OTHER_TENANT,
    });
    const otherClass = await classRepo.save({
      name: 'Matrix Other Class',
      academic_year_id: otherYear.id,
      tenant_id: OTHER_TENANT,
    });
    otherTenantSectionId = (
      await sectionRepo.save({
        section_name: 'Mx Other',
        class_id: otherClass.id,
        tenant_id: OTHER_TENANT,
      })
    ).id;
  }, 60000);

  afterAll(async () => {
    if (dataSource) await dataSource.destroy();
  });

  beforeEach(async () => {
    await setSettings();
    const studentRepo = dataSource.getRepository(Student);
    studentId1 = (
      await studentRepo.save({
        full_name: 'Student One',
        registration_number: 'MX-REG-1',
        roll_number: 1,
        class_section_id: sectionId,
        tenant_id: TENANT_ID,
      })
    ).id;
    studentId2 = (
      await studentRepo.save({
        full_name: 'Student Two',
        registration_number: 'MX-REG-2',
        roll_number: 2,
        class_section_id: sectionId,
        tenant_id: TENANT_ID,
      })
    ).id;

    const user = await dataSource.getRepository(User).save({
      email: `mx-teacher-${randomUUID()}@test.com`,
      full_name: 'Matrix Teacher',
    });
    const teacher = await dataSource.getRepository(Teacher).save({
      user_id: user.id,
      employee_id: `MX-${randomUUID().slice(0, 8)}`,
      tenant_id: TENANT_ID,
      designations: [],
    });
    await dataSource.getRepository(TeacherClassSection).save({
      teacher_id: teacher.id,
      section_id: sectionId,
      tenant_id: TENANT_ID,
      subject_id: null,
    });
    teacherUserId = user.id;
  });

  // ---- helpers ------------------------------------------------------------

  const P = AttendanceStatus.PRESENT;
  const A = AttendanceStatus.ABSENT;
  const entries = (s1: AttendanceStatus, s2: AttendanceStatus) => [
    { student_id: studentId1, status: s1 },
    { student_id: studentId2, status: s2 },
  ];

  /** Creates a day register through the ordinary daily write. */
  async function seedDay(date: string, s1 = P, s2 = P) {
    return service.putRegister({
      sectionId,
      tenantId: TENANT_ID,
      role: UserRole.ADMIN,
      userId: ADMIN_USER_ID,
      ip: null,
      userAgent: null,
      dto: {
        date,
        period_no: null,
        base_version: 0,
        client_request_id: randomUUID(),
        entries: entries(s1, s2),
      } as any,
    });
  }

  function matrix(
    days: Array<{ date: string; base_version: number | null; entries?: any[] }>,
    over: Record<string, unknown> = {},
    caller: Partial<{ role: string; userId: string; sectionId: string; tenantId: string }> = {},
  ) {
    return service.putRegisterMatrix({
      sectionId,
      tenantId: TENANT_ID,
      role: UserRole.ADMIN,
      userId: ADMIN_USER_ID,
      ip: null,
      userAgent: null,
      ...caller,
      dto: {
        client_request_id: randomUUID(),
        reason: 'month correction',
        days: days.map((d) => ({ entries: entries(A, A), ...d })),
        ...over,
      } as any,
    });
  }

  const statusOf = async (date: string, studentId: string) =>
    (
      await dataSource
        .getRepository(AttendanceRecord)
        .findOne({ where: { date, student_id: studentId } })
    )?.status ?? null;
  const sessionOf = (date: string) =>
    dataSource.getRepository(AttendanceSession).findOne({ where: { section_id: sectionId, date } });
  const auditCount = () =>
    dataSource.getRepository(AuditLog).count({ where: { tenant_id: TENANT_ID } });

  async function classHoliday(date: string) {
    const event = await dataSource.getRepository(CalendarEvent).save({
      tenant_id: TENANT_ID,
      academic_year_id: SEED_ACADEMIC_YEAR_ID,
      start_date: date,
      end_date: date,
      name: 'Class Break',
      counts_as_working_day: false,
      published_at: new Date(),
    });
    await dataSource
      .getRepository(CalendarEventClass)
      .save({ event_id: event.id, class_id: classId, tenant_id: TENANT_ID });
  }

  // ---- tests --------------------------------------------------------------

  it('saves three days; every changed existing mark has an audit row carrying the reason', async () => {
    const d1 = await seedDay(D1);
    const d2 = await seedDay(D2);
    const res = await matrix([
      { date: D1, base_version: d1.session.version, entries: entries(P, A) }, // student 2 changes
      { date: D2, base_version: d2.session.version, entries: entries(P, P) }, // unchanged
      { date: D3, base_version: null, entries: entries(A, P) }, // back-fill
    ]);

    expect(res.saved_dates).toEqual([D1, D2, D3]);
    expect(Object.keys(res.versions).sort()).toEqual([D1, D2, D3]);
    expect(await statusOf(D1, studentId2)).toBe(A);

    const updates = await dataSource.getRepository(AuditLog).find({
      where: { tenant_id: TENANT_ID, entity_type: 'AttendanceRecord', action: 'UPDATE' as any },
    });
    // Only D1/student 2 changed an existing mark.
    expect(updates).toHaveLength(1);
    expect((updates[0].new_values as any).reason).toBe('month correction');
  });

  it('back-fill: null base on a past unmarked day is born FINALIZED; on today it is a DRAFT', async () => {
    await matrix([{ date: D1, base_version: null }]);
    const past = await sessionOf(D1);
    expect(past?.state).toBe(AttendanceSessionState.FINALIZED);
    expect(past?.finalized_at).not.toBeNull();

    await matrix([{ date: today(), base_version: null }]);
    expect((await sessionOf(today()))?.state).toBe(AttendanceSessionState.DRAFT);
  });

  it('one stale day among three: 409 naming it, and no row of the other two changed', async () => {
    const d1 = await seedDay(D1);
    const d2 = await seedDay(D2);
    const d3 = await seedDay(D3);
    const before = await auditCount();

    await expect(
      matrix([
        { date: D1, base_version: d1.session.version },
        { date: D2, base_version: d2.session.version + 7 }, // stale
        { date: D3, base_version: d3.session.version },
      ]),
    ).rejects.toMatchObject({
      status: 409,
      response: { details: { code: 'ATTENDANCE_MATRIX_CONFLICT', dates: [D2] } },
    });
    expect(await statusOf(D1, studentId1)).toBe(P);
    expect(await statusOf(D3, studentId1)).toBe(P);
    expect(await auditCount()).toBe(before);
  });

  it('null base on a day that now has a register is a conflict', async () => {
    await seedDay(D1);
    await expect(matrix([{ date: D1, base_version: null }])).rejects.toMatchObject({
      status: 409,
      response: { details: { code: 'ATTENDANCE_MATRIX_CONFLICT', dates: [D1] } },
    });
  });

  it('a failure while writing the LAST day rolls back the days already written (one transaction)', async () => {
    const d1 = await seedDay(D1);
    const d2 = await seedDay(D2);
    const stranger = randomUUID(); // passes every pre-check, fails the roster check on D3 only
    await expect(
      matrix([
        { date: D1, base_version: d1.session.version, entries: entries(A, A) },
        { date: D2, base_version: d2.session.version, entries: entries(A, A) },
        { date: D3, base_version: null, entries: [{ student_id: stranger, status: A }] },
      ]),
    ).rejects.toMatchObject({ response: { details: { code: 'ATTENDANCE_UNKNOWN_STUDENTS' } } });
    // If the days were saved in separate transactions D1 and D2 would now be ABSENT.
    expect(await statusOf(D1, studentId1)).toBe(P);
    expect(await statusOf(D2, studentId2)).toBe(P);
    expect(await sessionOf(D3)).toBeNull();
  });

  it('a holiday scoped to the section class is a locked date; nothing is written', async () => {
    await classHoliday(D3);
    await expect(
      matrix([
        { date: D2, base_version: null },
        { date: D3, base_version: null },
      ]),
    ).rejects.toMatchObject({
      status: 422,
      response: { details: { code: 'ATTENDANCE_MATRIX_LOCKED_DATE', dates: [D3] } },
    });
    expect(await sessionOf(D2)).toBeNull();
  });

  it('a future date is a locked date', async () => {
    const future = new Date();
    future.setUTCDate(future.getUTCDate() + 1);
    const f = future.toISOString().slice(0, 10);
    await expect(matrix([{ date: f, base_version: null }])).rejects.toMatchObject({
      status: 422,
      response: { details: { code: 'ATTENDANCE_MATRIX_LOCKED_DATE', dates: [f] } },
    });
  });

  it('outside the window without ATTENDANCE_CORRECT is 403; with it but no reason is 422', async () => {
    const d1 = await seedDay(D1);
    await expect(
      matrix(
        [{ date: D1, base_version: d1.session.version }],
        {},
        {
          role: UserRole.TEACHER,
          userId: teacherUserId,
        },
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);

    await expect(
      matrix([{ date: D1, base_version: d1.session.version }], { reason: undefined }),
    ).rejects.toMatchObject({
      status: 422,
      response: { details: { code: 'ATTENDANCE_REASON_REQUIRED' } },
    });
    expect(await statusOf(D1, studentId1)).toBe(P);
  });

  it('replaying the same client_request_id returns 200 and writes nothing', async () => {
    const requestId = randomUUID();
    const first = await matrix([{ date: D1, base_version: null }], {
      client_request_id: requestId,
    });
    const auditAfterFirst = await auditCount();
    const replay = await matrix([{ date: D1, base_version: null }], {
      client_request_id: requestId,
    });
    expect(replay).toEqual(first);
    expect(await auditCount()).toBe(auditAfterFirst);
  });

  it('leaves a period register on the same date untouched', async () => {
    const day = await seedDay(D1);
    const period = await dataSource.getRepository(AttendanceSession).save({
      tenant_id: TENANT_ID,
      section_id: sectionId,
      date: D1,
      period_no: 2,
      state: AttendanceSessionState.DRAFT,
    });
    await dataSource.getRepository(AttendanceRecord).save({
      tenant_id: TENANT_ID,
      session_id: period.id,
      student_id: studentId1,
      date: D1,
      status: P,
    });

    await matrix([{ date: D1, base_version: day.session.version, entries: entries(A, A) }]);

    const after = await dataSource
      .getRepository(AttendanceSession)
      .findOneByOrFail({ id: period.id });
    expect(after.version).toBe(period.version);
    const periodRecords = await dataSource
      .getRepository(AttendanceRecord)
      .find({ where: { session_id: period.id } });
    expect(periodRecords.map((r) => r.status)).toEqual([P]);
  });

  it("another tenant's section id is 403", async () => {
    await expect(
      matrix([{ date: D1, base_version: null }], {}, { sectionId: otherTenantSectionId }),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('keeps minutes_late and remarks of a mark that stays LATE; clears minutes when it changes', async () => {
    const d1 = await service.putRegister({
      sectionId,
      tenantId: TENANT_ID,
      role: UserRole.ADMIN,
      userId: ADMIN_USER_ID,
      ip: null,
      userAgent: null,
      dto: {
        date: D1,
        period_no: null,
        base_version: 0,
        client_request_id: randomUUID(),
        entries: [
          {
            student_id: studentId1,
            status: AttendanceStatus.LATE,
            minutes_late: 15,
            remarks: 'bus',
          },
          { student_id: studentId2, status: AttendanceStatus.LATE, minutes_late: 5 },
        ],
      } as any,
    });
    await matrix([
      {
        date: D1,
        base_version: d1.session.version,
        entries: [
          { student_id: studentId1, status: AttendanceStatus.LATE }, // stays LATE
          { student_id: studentId2, status: P }, // changes
        ],
      },
    ]);
    const records = await dataSource.getRepository(AttendanceRecord).find({ where: { date: D1 } });
    const r1 = records.find((r) => r.student_id === studentId1)!;
    const r2 = records.find((r) => r.student_id === studentId2)!;
    expect([r1.status, r1.minutes_late, r1.remarks]).toEqual([AttendanceStatus.LATE, 15, 'bus']);
    expect([r2.status, r2.minutes_late]).toEqual([P, null]);
  });

  it('queues no guardian notification even with auto-absent notification on', async () => {
    await setSettings({ autoAbsentNotification: { enabled: true, cutoffTime: '10:00' } });
    await matrix([{ date: D1, base_version: null, entries: entries(A, A) }]);
    expect(await dataSource.getRepository(CommunicationLog).count()).toBe(0);
    expect(await dataSource.getRepository(ReminderBatch).count()).toBe(0);
  });

  it('rejects duplicate dates and days spanning two months with 400', async () => {
    await expect(
      matrix([
        { date: D1, base_version: null },
        { date: D1, base_version: null },
      ]),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      matrix([
        { date: D1, base_version: null },
        { date: '2026-04-01', base_version: null },
      ]),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('a day with no register and no entries is 422 (it would be born FINALIZED and empty); nothing is written', async () => {
    const d1 = await seedDay(D1);
    await expect(
      matrix([
        { date: D1, base_version: d1.session.version, entries: [] }, // existing: allowed
        { date: D2, base_version: null, entries: [] }, // new + empty: refused
        { date: D3, base_version: null }, // new with marks: fine on its own
      ]),
    ).rejects.toMatchObject({
      status: 422,
      response: { details: { code: 'ATTENDANCE_MATRIX_EMPTY_DAY', dates: [D2] } },
    });
    expect(await sessionOf(D2)).toBeNull();
    expect(await sessionOf(D3)).toBeNull();
  });

  it('a FINALIZED day inside the window is 403 ATTENDANCE_WINDOW_CLOSED without ATTENDANCE_CORRECT', async () => {
    const t = today();
    await seedDay(t);
    const finalized = await service.finalize({
      sectionId,
      tenantId: TENANT_ID,
      role: UserRole.ADMIN,
      userId: ADMIN_USER_ID,
      date: t,
      periodNo: null,
      ip: null,
      userAgent: null,
    });
    await expect(
      matrix(
        [{ date: t, base_version: finalized.session.version }],
        {},
        { role: UserRole.TEACHER, userId: teacherUserId },
      ),
    ).rejects.toMatchObject({
      status: 403,
      response: { details: { code: 'ATTENDANCE_WINDOW_CLOSED', dates: [t] } },
    });
    expect(await statusOf(t, studentId1)).toBe(P);
  });
});

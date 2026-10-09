import { randomUUID } from 'crypto';
import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from 'vitest';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { DataSource } from 'typeorm';
import { getDataSourceToken } from '@nestjs/typeorm';
import { createTestModule } from '@test/helpers/module.helper';
import { ALL_ENTITIES } from '@test/all-entities';
import { SEED_ACADEMIC_YEAR_ID, SEED_TENANT_ID, SEED_ADMIN_USER_ID } from '@test/constants';
import { seedPeriodRoutine } from './attendance-periods.fixture';
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
import { Shift } from '../routines/entities/shift.entity';
import { RoutineSlot } from '../routines/entities/routine-slot.entity';
import { Routine } from '../routines/entities/routine.entity';
import {
  AttendanceSessionState,
  AttendanceStatus,
  RoutineState,
  TeacherAssignmentType,
  UserRole,
} from '@biddaloy/shared';

/**
 * Integration tests for `AttendanceService` — the write side of attendance.
 * Runs against a real, migrated test database.
 *
 * `attendance_sessions`, `attendance_records`, `students`, `teachers`,
 * `teacher_class_sections`, and `audit_logs` are all "transactional" tables
 * (see `test/reset-order.ts`) — the global `beforeEach` in `test/setup.ts`
 * truncates them before *every* test. So the section/class fixtures are
 * created once in `beforeAll`, but the roster, teacher mapping, and school
 * settings are re-created in this file's own `beforeEach`.
 *
 * Every test disables the default Friday weekly-off (`weeklyOffDays: []`)
 * unless it is itself the non-working-day test, and computes "future"/
 * "past"/"outside window" dates relative to the real current time rather
 * than a fixed date — the suite must not become flaky as the calendar
 * moves forward.
 */
describe('AttendanceService (integration)', () => {
  let service: AttendanceService;
  let dataSource: DataSource;

  const TENANT_ID = SEED_TENANT_ID;
  const OTHER_TENANT = '00000000-0000-4000-8000-000000000099';
  const ADMIN_USER_ID = SEED_ADMIN_USER_ID;

  let sectionId: string;
  let yearId: string;
  let classId: string;
  let otherTenantSectionId: string;

  let studentId1: string;
  let studentId2: string;
  let teacherUserId: string;

  function isoDate(date: Date): string {
    return date.toISOString().slice(0, 10);
  }
  function addDays(days: number): string {
    const d = new Date();
    d.setUTCDate(d.getUTCDate() + days);
    return isoDate(d);
  }
  const TODAY = () => addDays(0);
  const YESTERDAY = () => addDays(-1);
  const FUTURE = () => addDays(5);
  const OUTSIDE_WINDOW = () => addDays(-10); // default correctionWindowDays is 2

  async function setTenantSettings(
    tenantId: string,
    attendance: Record<string, unknown>,
  ): Promise<void> {
    await dataSource
      .getRepository(School)
      .update({ id: tenantId }, { settings: { version: 1, attendance } as any });
  }

  beforeAll(async () => {
    const module = await createTestModule(
      ALL_ENTITIES,
      [],
      [ConfigModule.forRoot({ isGlobal: true }), AttendanceModule, AuthModule],
    );
    service = module.get<AttendanceService>(AttendanceService);
    dataSource = module.get<DataSource>(getDataSourceToken());

    const schoolRepo = dataSource.getRepository(School);
    if (!(await schoolRepo.findOne({ where: { id: OTHER_TENANT } }))) {
      await schoolRepo.save({ id: OTHER_TENANT, name: 'Other School', slug: 'other-school' });
    }

    const yearRepo = dataSource.getRepository(AcademicYear);
    const classRepo = dataSource.getRepository(Class);
    const sectionRepo = dataSource.getRepository(ClassSection);

    const year = await yearRepo.save({
      name: 'Attendance Service Test Year',
      start_date: '2026-01-01',
      end_date: '2026-12-31',
      tenant_id: TENANT_ID,
    });
    const klass = await classRepo.save({
      name: 'Attendance Test Class',
      academic_year_id: year.id,
      tenant_id: TENANT_ID,
    });
    const section = await sectionRepo.save({
      section_name: 'Att Section', // section_name is varchar(20)
      class_id: klass.id,
      tenant_id: TENANT_ID,
    });
    sectionId = section.id;
    yearId = year.id;
    classId = klass.id;

    const otherYear = await yearRepo.save({
      name: 'Other Tenant Year',
      start_date: '2026-01-01',
      end_date: '2026-12-31',
      tenant_id: OTHER_TENANT,
    });
    const otherClass = await classRepo.save({
      name: 'Other Class',
      academic_year_id: otherYear.id,
      tenant_id: OTHER_TENANT,
    });
    const otherSection = await sectionRepo.save({
      section_name: 'Other Section',
      class_id: otherClass.id,
      tenant_id: OTHER_TENANT,
    });
    otherTenantSectionId = otherSection.id;
  }, 60000);

  afterAll(async () => {
    if (dataSource) {
      await dataSource.destroy();
    }
  });

  beforeEach(async () => {
    // Baseline policy for most tests: no weekly-off collision, a 2-day
    // correction window, future dates refused by default.
    await setTenantSettings(TENANT_ID, {
      weeklyOffDays: [],
      correctionWindowDays: 2,
      allowFutureDates: false,
    });

    const studentRepo = dataSource.getRepository(Student);
    const s1 = await studentRepo.save({
      full_name: 'Student One',
      registration_number: 'ATT-REG-1',
      roll_number: 1,
      class_section_id: sectionId,
      tenant_id: TENANT_ID,
    });
    const s2 = await studentRepo.save({
      full_name: 'Student Two',
      registration_number: 'ATT-REG-2',
      roll_number: 2,
      class_section_id: sectionId,
      tenant_id: TENANT_ID,
    });
    studentId1 = s1.id;
    studentId2 = s2.id;

    const userRepo = dataSource.getRepository(User);
    const teacherRepo = dataSource.getRepository(Teacher);
    const tcsRepo = dataSource.getRepository(TeacherClassSection);
    const user = await userRepo.save({
      email: `attendance-teacher-${Date.now()}-${Math.random()}@test.com`,
      full_name: 'Attendance Teacher',
    });
    const teacher = await teacherRepo.save({
      user_id: user.id,
      employee_id: `ATT-EMP-${Date.now()}-${Math.floor(Math.random() * 100000)}`,
      tenant_id: TENANT_ID,
      designations: [],
    });
    await tcsRepo.save({
      teacher_id: teacher.id,
      section_id: sectionId,
      tenant_id: TENANT_ID,
      subject_id: null,
    });
    teacherUserId = user.id;
  });

  function basePutDto(overrides: Record<string, unknown> = {}) {
    return {
      date: TODAY(),
      period_no: null,
      base_version: 0,
      client_request_id: randomUUID(),
      entries: [
        { student_id: studentId1, status: AttendanceStatus.PRESENT },
        { student_id: studentId2, status: AttendanceStatus.ABSENT },
      ],
      ...overrides,
    } as any;
  }

  function putParams(overrides: Record<string, unknown> = {}) {
    return {
      sectionId,
      tenantId: TENANT_ID,
      role: UserRole.ADMIN,
      userId: ADMIN_USER_ID,
      ip: '127.0.0.1',
      userAgent: 'vitest',
      ...overrides,
    };
  }

  describe('putRegister', () => {
    it('creates a session and records on the first submission', async () => {
      const dto = basePutDto();
      const result = await service.putRegister(putParams({ dto }));

      expect(result.session.id).not.toBeNull();
      expect(result.session.version).toBe(1);
      expect(result.students.find((s) => s.student_id === studentId1)?.status).toBe(
        AttendanceStatus.PRESENT,
      );
      expect(result.students.find((s) => s.student_id === studentId2)?.status).toBe(
        AttendanceStatus.ABSENT,
      );

      const sessions = await dataSource
        .getRepository(AttendanceSession)
        .find({ where: { tenant_id: TENANT_ID, section_id: sectionId, date: dto.date } });
      expect(sessions).toHaveLength(1);

      const records = await dataSource
        .getRepository(AttendanceRecord)
        .find({ where: { session_id: sessions[0].id } });
      expect(records).toHaveLength(2);
    });

    it('replaying the same client_request_id writes nothing and returns 200 both times', async () => {
      const clientRequestId = randomUUID();
      const dto = basePutDto({ client_request_id: clientRequestId });

      const first = await service.putRegister(putParams({ dto }));
      // A replay reuses the same base_version the client would have sent
      // originally (0) — the server detects the replay before the version
      // check even runs, so this must succeed rather than 409.
      const second = await service.putRegister(putParams({ dto }));

      expect(second.session.id).toBe(first.session.id);
      expect(second.session.version).toBe(first.session.version);

      const sessions = await dataSource
        .getRepository(AttendanceSession)
        .find({ where: { tenant_id: TENANT_ID, section_id: sectionId, date: dto.date } });
      expect(sessions).toHaveLength(1);

      const records = await dataSource
        .getRepository(AttendanceRecord)
        .find({ where: { session_id: sessions[0].id } });
      expect(records).toHaveLength(2);
    });

    it('rejects a stale base_version with 409 carrying the current register', async () => {
      const dto1 = basePutDto();
      await service.putRegister(putParams({ dto: dto1 }));

      const staleDto = basePutDto({ base_version: 0, client_request_id: randomUUID() });

      let caught: ConflictException | undefined;
      try {
        await service.putRegister(putParams({ dto: staleDto }));
      } catch (error) {
        caught = error as ConflictException;
      }

      expect(caught).toBeInstanceOf(ConflictException);
      expect(caught?.getStatus()).toBe(409);
      const body = caught?.getResponse() as { details?: Record<string, unknown> };
      expect(body.details).toMatchObject({
        code: 'ATTENDANCE_VERSION_CONFLICT',
        current_version: 1,
      });
      expect((body.details?.register as any)?.session?.version).toBe(1);
    });

    it('rejects an unknown student id with 422', async () => {
      const dto = basePutDto({
        entries: [{ student_id: randomUUID(), status: AttendanceStatus.PRESENT }],
      });

      await expect(service.putRegister(putParams({ dto }))).rejects.toBeInstanceOf(
        UnprocessableEntityException,
      );
    });

    it('rejects a duplicate student_id in the same payload with 400', async () => {
      const dto = basePutDto({
        entries: [
          { student_id: studentId1, status: AttendanceStatus.PRESENT },
          { student_id: studentId1, status: AttendanceStatus.ABSENT },
        ],
      });

      let caught: BadRequestException | undefined;
      try {
        await service.putRegister(putParams({ dto }));
      } catch (error) {
        caught = error as BadRequestException;
      }
      expect(caught).toBeInstanceOf(BadRequestException);
      expect(caught?.getStatus()).toBe(400);
    });

    it('refuses a future date by default, then allows it as LEAVE-only once the policy permits it', async () => {
      const dto = basePutDto({ date: FUTURE(), base_version: 0 });

      await expect(service.putRegister(putParams({ dto }))).rejects.toBeInstanceOf(
        UnprocessableEntityException,
      );

      await setTenantSettings(TENANT_ID, {
        weeklyOffDays: [],
        correctionWindowDays: 2,
        allowFutureDates: true,
      });

      // Still refused when a non-LEAVE status is submitted for a future date.
      await expect(service.putRegister(putParams({ dto }))).rejects.toBeInstanceOf(
        UnprocessableEntityException,
      );

      const leaveOnlyDto = basePutDto({
        date: FUTURE(),
        base_version: 0,
        client_request_id: randomUUID(),
        entries: [
          { student_id: studentId1, status: AttendanceStatus.LEAVE },
          { student_id: studentId2, status: AttendanceStatus.LEAVE },
        ],
      });
      const result = await service.putRegister(putParams({ dto: leaveOnlyDto }));
      expect(result.session.id).not.toBeNull();
    });

    it('refuses a non-working day by default, then allows it when forced with ATTENDANCE_CORRECT', async () => {
      await setTenantSettings(TENANT_ID, {
        weeklyOffDays: [],
        correctionWindowDays: 2,
        allowFutureDates: false,
      });
      // Mark yesterday as the tenant's weekly off day by pinning it directly.
      const yesterday = new Date(YESTERDAY());
      const weekday = yesterday.getUTCDay();
      await setTenantSettings(TENANT_ID, {
        weeklyOffDays: [weekday],
        correctionWindowDays: 2,
        allowFutureDates: false,
      });

      const dto = basePutDto({ date: YESTERDAY(), base_version: 0 });
      await expect(service.putRegister(putParams({ dto }))).rejects.toBeInstanceOf(
        UnprocessableEntityException,
      );

      // ADMIN holds ATTENDANCE_CORRECT — forcing it through succeeds.
      const forcedDto = basePutDto({
        date: YESTERDAY(),
        base_version: 0,
        client_request_id: randomUUID(),
        force_non_working_day: true,
      });
      const result = await service.putRegister(putParams({ dto: forcedDto }));
      expect(result.session.id).not.toBeNull();
      expect(result.non_working_day).toBe(true);
    });

    it('403s a correction outside the window without ATTENDANCE_CORRECT, and requires a reason with it', async () => {
      // First submission establishes a session for an old date.
      const initialDto = basePutDto({ date: OUTSIDE_WINDOW(), base_version: 0 });
      const created = await service.putRegister(
        putParams({ role: UserRole.TEACHER, userId: teacherUserId, dto: initialDto }),
      );
      expect(created.session.version).toBe(1);

      // TEACHER lacks ATTENDANCE_CORRECT — re-submitting the same old date
      // (now a correction, since a session already exists) is 403.
      const correctionDto = basePutDto({
        date: OUTSIDE_WINDOW(),
        base_version: created.session.version,
        client_request_id: randomUUID(),
        entries: [
          { student_id: studentId1, status: AttendanceStatus.LATE, minutes_late: 5 },
          { student_id: studentId2, status: AttendanceStatus.ABSENT },
        ],
      });
      await expect(
        service.putRegister(
          putParams({ role: UserRole.TEACHER, userId: teacherUserId, dto: correctionDto }),
        ),
      ).rejects.toBeInstanceOf(ForbiddenException);

      // ADMIN holds ATTENDANCE_CORRECT, but still needs a `reason`.
      await expect(service.putRegister(putParams({ dto: correctionDto }))).rejects.toBeInstanceOf(
        UnprocessableEntityException,
      );

      // With a reason, ADMIN succeeds.
      const withReasonDto = { ...correctionDto, reason: 'Corrected after review' };
      const result = await service.putRegister(putParams({ dto: withReasonDto }));
      expect(result.students.find((s) => s.student_id === studentId1)?.status).toBe(
        AttendanceStatus.LATE,
      );
    });

    it('writes an audit row only for changed records, not for a resubmission of identical marks', async () => {
      const dto = basePutDto();
      const first = await service.putRegister(putParams({ dto }));

      const auditRepo = dataSource.getRepository(AuditLog);
      const recordAuditsAfterCreate = await auditRepo.count({
        where: { tenant_id: TENANT_ID, entity_type: 'AttendanceRecord' },
      });
      expect(recordAuditsAfterCreate).toBe(2); // one CREATE per new record

      // Re-submit with a new client_request_id but identical marks.
      const resubmitDto = basePutDto({
        base_version: first.session.version,
        client_request_id: randomUUID(),
      });
      await service.putRegister(putParams({ dto: resubmitDto }));

      const recordAuditsAfterResubmit = await auditRepo.count({
        where: { tenant_id: TENANT_ID, entity_type: 'AttendanceRecord' },
      });
      expect(recordAuditsAfterResubmit).toBe(recordAuditsAfterCreate);

      // Now actually change one mark — exactly one new UPDATE audit row.
      const changedDto = basePutDto({
        base_version: first.session.version + 1,
        client_request_id: randomUUID(),
        entries: [
          { student_id: studentId1, status: AttendanceStatus.LATE, minutes_late: 10 },
          { student_id: studentId2, status: AttendanceStatus.ABSENT },
        ],
      });
      await service.putRegister(putParams({ dto: changedDto }));

      const recordAuditsAfterChange = await auditRepo.count({
        where: { tenant_id: TENANT_ID, entity_type: 'AttendanceRecord' },
      });
      expect(recordAuditsAfterChange).toBe(recordAuditsAfterResubmit + 1);

      const updateAudits = await auditRepo.find({
        where: { tenant_id: TENANT_ID, entity_type: 'AttendanceRecord', action: 'UPDATE' as any },
      });
      expect(updateAudits).toHaveLength(1);
    });

    // The daily register sends the whole mark; only the matrix keeps stored
    // minutes/remarks (writeRegisterDay's `ctx.matrix`).
    it('a resubmission without remarks/minutes_late clears both to null', async () => {
      const first = await service.putRegister(
        putParams({
          dto: basePutDto({
            entries: [
              {
                student_id: studentId1,
                status: AttendanceStatus.LATE,
                minutes_late: 12,
                remarks: 'bus',
              },
              { student_id: studentId2, status: AttendanceStatus.ABSENT, remarks: 'sick' },
            ],
          }),
        }),
      );
      const second = await service.putRegister(
        putParams({
          dto: basePutDto({
            base_version: first.session.version,
            entries: [
              { student_id: studentId1, status: AttendanceStatus.LATE },
              { student_id: studentId2, status: AttendanceStatus.ABSENT },
            ],
          }),
        }),
      );
      const by = Object.fromEntries(second.students.map((s) => [s.student_id, s]));
      expect([by[studentId1].minutes_late, by[studentId1].remarks]).toEqual([null, null]);
      expect(by[studentId2].remarks).toBeNull();
    });

    // The access gate normally refuses a missing section first; this pins the
    // write path's own fallback (a section gone between gate and write).
    it('a missing class section row is a 404, never a tenant-wide holiday check', async () => {
      const access = (service as any).attendanceAccessService;
      const spy = vi.spyOn(access, 'assertCanAccessSection').mockResolvedValue({} as any);
      try {
        await expect(
          service.putRegister(putParams({ sectionId: randomUUID(), dto: basePutDto() })),
        ).rejects.toBeInstanceOf(NotFoundException);
      } finally {
        spy.mockRestore();
      }
    });

    it('403s a TEACHER of tenant A attempting to mark a section that belongs to tenant B', async () => {
      const dto = basePutDto();
      await expect(
        service.putRegister(
          putParams({
            sectionId: otherTenantSectionId,
            role: UserRole.TEACHER,
            userId: teacherUserId,
            dto,
          }),
        ),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });
  });

  describe('getRegister', () => {
    it('returns an empty (unmarked) register with version 0 when no session exists yet', async () => {
      const result = await service.getRegister({
        sectionId,
        date: TODAY(),
        periodNo: null,
        tenantId: TENANT_ID,
        role: UserRole.ADMIN,
        userId: ADMIN_USER_ID,
      });

      expect(result.session.id).toBeNull();
      expect(result.session.version).toBe(0);
      expect(result.students.every((s) => s.status === null)).toBe(true);
    });
  });

  describe('finalize', () => {
    it('finalizes a submitted register, and is a no-op the second time', async () => {
      const dto = basePutDto();
      const created = await service.putRegister(putParams({ dto }));
      expect(created.session.state).toBe('DRAFT');

      const finalized = await service.finalize({
        sectionId,
        tenantId: TENANT_ID,
        role: UserRole.ADMIN,
        userId: ADMIN_USER_ID,
        date: dto.date,
        periodNo: null,
        ip: null,
        userAgent: null,
      });
      expect(finalized.session.state).toBe('FINALIZED');
      const versionAfterFinalize = finalized.session.version;

      const finalizedAgain = await service.finalize({
        sectionId,
        tenantId: TENANT_ID,
        role: UserRole.ADMIN,
        userId: ADMIN_USER_ID,
        date: dto.date,
        periodNo: null,
        ip: null,
        userAgent: null,
      });
      expect(finalizedAgain.session.version).toBe(versionAfterFinalize);
    });
  });

  describe('correctRecord', () => {
    it('requires a reason, bumps the session version, and writes an audit row', async () => {
      const dto = basePutDto();
      const created = await service.putRegister(putParams({ dto }));
      const recordId = created.students.find((s) => s.student_id === studentId1)?.record_id;
      expect(recordId).toBeTruthy();

      await expect(
        service.correctRecord({
          recordId: recordId as string,
          tenantId: TENANT_ID,
          role: UserRole.ADMIN,
          userId: ADMIN_USER_ID,
          dto: { status: AttendanceStatus.LATE, minutes_late: 20 } as any,
          ip: null,
          userAgent: null,
        }),
      ).rejects.toBeInstanceOf(UnprocessableEntityException);

      const result = await service.correctRecord({
        recordId: recordId as string,
        tenantId: TENANT_ID,
        role: UserRole.ADMIN,
        userId: ADMIN_USER_ID,
        dto: { status: AttendanceStatus.LATE, minutes_late: 20, reason: 'Arrived late' } as any,
        ip: '127.0.0.1',
        userAgent: 'vitest',
      });

      expect(result.session.version).toBe(created.session.version + 1);
      expect(result.students.find((s) => s.student_id === studentId1)?.status).toBe(
        AttendanceStatus.LATE,
      );
      expect(result.students.find((s) => s.student_id === studentId1)?.correction_count).toBe(1);
    });
  });

  describe('getRecordHistory', () => {
    it("returns a corrected record's audit history for a TEACHER with no AUDIT_LOG_READ", async () => {
      const dto = basePutDto();
      const created = await service.putRegister(
        putParams({ role: UserRole.TEACHER, userId: teacherUserId, dto }),
      );
      const recordId = created.students.find((s) => s.student_id === studentId1)
        ?.record_id as string;

      await service.correctRecord({
        recordId,
        tenantId: TENANT_ID,
        role: UserRole.TEACHER,
        userId: teacherUserId,
        dto: { status: AttendanceStatus.LATE, minutes_late: 5, reason: 'Late arrival' } as any,
        ip: null,
        userAgent: null,
      });

      const history = await service.getRecordHistory({
        recordId,
        tenantId: TENANT_ID,
        role: UserRole.TEACHER,
        userId: teacherUserId,
        query: {} as any,
      });

      expect(history.data.length).toBeGreaterThanOrEqual(1);
      expect(history.data[0].entity_type).toBe('AttendanceRecord');
    });

    it("succeeds for a TEACHER mapped to the record's section", async () => {
      const dto = basePutDto();
      const created = await service.putRegister(putParams({ dto })); // as ADMIN
      const recordId = created.students.find((s) => s.student_id === studentId1)
        ?.record_id as string;

      await expect(
        service.getRecordHistory({
          recordId,
          tenantId: TENANT_ID,
          role: UserRole.TEACHER,
          userId: teacherUserId, // mapped to `sectionId`, so this should succeed
          query: {} as any,
        }),
      ).resolves.toBeDefined();
    });

    it("403s a TEACHER reading a record from a section they aren't mapped to", async () => {
      const dto = basePutDto();
      const created = await service.putRegister(putParams({ dto })); // as ADMIN
      const recordId = created.students.find((s) => s.student_id === studentId1)
        ?.record_id as string;

      const unmappedTeacherUser = await dataSource.getRepository(User).save({
        email: `attendance-unmapped-teacher-${Date.now()}-${Math.random()}@test.com`,
        full_name: 'Unmapped Teacher',
      });
      await dataSource.getRepository(Teacher).save({
        user_id: unmappedTeacherUser.id,
        employee_id: `ATT-EMP-UNMAPPED-${Date.now()}-${Math.floor(Math.random() * 100000)}`,
        tenant_id: TENANT_ID,
        designations: [],
      });
      // No TeacherClassSection row is created for this teacher, so they are
      // not mapped to `sectionId` at all.

      await expect(
        service.getRecordHistory({
          recordId,
          tenantId: TENANT_ID,
          role: UserRole.TEACHER,
          userId: unmappedTeacherUser.id,
          query: {} as any,
        }),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });
  });

  describe('listMySections', () => {
    it("includes today's marking progress for a section the TEACHER is mapped to", async () => {
      const dto = basePutDto();
      await service.putRegister(putParams({ role: UserRole.TEACHER, userId: teacherUserId, dto }));

      const sections = await service.listMySections({
        role: UserRole.TEACHER,
        userId: teacherUserId,
        tenantId: TENANT_ID,
        date: dto.date,
      });

      expect(sections).toHaveLength(1);
      expect(sections[0].section_id).toBe(sectionId);
      expect(sections[0].today?.present).toBe(1);
      expect(sections[0].today?.absent).toBe(1);
      expect(sections[0].today?.unmarked).toBe(0);
    });

    // ---- #1587: check-list data -------------------------------------------

    async function mapTeacher(
      secId: string,
      fullName: string,
      type: TeacherAssignmentType,
    ): Promise<void> {
      const user = await dataSource.getRepository(User).save({
        email: `mst-${randomUUID()}@test.com`,
        full_name: fullName,
      });
      const teacher = await dataSource.getRepository(Teacher).save({
        user_id: user.id,
        employee_id: `MST-${randomUUID().slice(0, 8)}`,
        tenant_id: TENANT_ID,
        designations: [],
      });
      await dataSource.getRepository(TeacherClassSection).save({
        teacher_id: teacher.id,
        section_id: secId,
        tenant_id: TENANT_ID,
        subject_id: null,
        assignment_type: type,
      });
    }

    async function makeOtherClassSection(): Promise<{ classId: string; sectionId: string }> {
      const klass = await dataSource.getRepository(Class).save({
        name: `Second Class ${randomUUID().slice(0, 6)}`,
        academic_year_id: yearId,
        tenant_id: TENANT_ID,
      });
      const sec = await dataSource.getRepository(ClassSection).save({
        section_name: 'Second Sec',
        class_id: klass.id,
        tenant_id: TENANT_ID,
      });
      return { classId: klass.id, sectionId: sec.id };
    }

    async function classScopedHoliday(date: string, classIds: string[]): Promise<void> {
      const event = await dataSource.getRepository(CalendarEvent).save({
        tenant_id: TENANT_ID,
        academic_year_id: yearId,
        start_date: date,
        end_date: date,
        name: 'Class Break',
        counts_as_working_day: false,
        published_at: new Date(),
      });
      for (const cid of classIds) {
        await dataSource
          .getRepository(CalendarEventClass)
          .save({ event_id: event.id, class_id: cid, tenant_id: TENANT_ID });
      }
    }

    // beforeEach maps its teacher with the default (CLASS_TEACHER) type; drop it.
    const demoteBaseTeacher = () =>
      dataSource.getRepository(TeacherClassSection).delete({ section_id: sectionId });

    const adminList = (date?: string) =>
      service.listMySections({
        role: UserRole.ADMIN,
        userId: ADMIN_USER_ID,
        tenantId: TENANT_ID,
        date,
      });

    it('returns class_id, and a null class teacher when nobody holds that role', async () => {
      await demoteBaseTeacher();
      await mapTeacher(
        sectionId,
        'Assistant Person',
        TeacherAssignmentType.ASSISTANT_CLASS_TEACHER,
      );
      const item = (await adminList(TODAY())).find((x) => x.section_id === sectionId)!;
      expect(item.class_id).toBe(classId);
      expect(item.class_teacher_name).toBeNull();
    });

    it('returns the class teacher name, never an assistant', async () => {
      await demoteBaseTeacher();
      await mapTeacher(
        sectionId,
        'Assistant Person',
        TeacherAssignmentType.ASSISTANT_CLASS_TEACHER,
      );
      await mapTeacher(sectionId, 'Head Teacher', TeacherAssignmentType.CLASS_TEACHER);
      const item = (await adminList(TODAY())).find((x) => x.section_id === sectionId)!;
      expect(item.class_teacher_name).toBe('Head Teacher');
    });

    it('is_working_day is false only for the class a holiday is scoped to', async () => {
      const other = await makeOtherClassSection();
      await classScopedHoliday(TODAY(), [classId]);
      const items = await adminList(TODAY());
      expect(items.find((x) => x.section_id === sectionId)!.is_working_day).toBe(false);
      expect(items.find((x) => x.section_id === other.sectionId)!.is_working_day).toBe(true);
    });

    it('refuses a future date with 422 ATTENDANCE_FUTURE_DATE', async () => {
      await expect(adminList(FUTURE())).rejects.toMatchObject({
        status: 422,
        response: { details: { code: 'ATTENDANCE_FUTURE_DATE' } },
      });
    });

    it('lists a future date when the tenant allows future dates', async () => {
      await setTenantSettings(TENANT_ID, {
        weeklyOffDays: [],
        correctionWindowDays: 2,
        allowFutureDates: true,
      });
      const items = await adminList(FUTURE());
      expect(items.some((x) => x.section_id === sectionId)).toBe(true);
    });

    it('refuses a future date even for a caller with no sections', async () => {
      await demoteBaseTeacher(); // the TEACHER now has no sections at all
      await expect(
        service.listMySections({
          role: UserRole.TEACHER,
          userId: teacherUserId,
          tenantId: TENANT_ID,
          date: FUTURE(),
        }),
      ).rejects.toMatchObject({ response: { details: { code: 'ATTENDANCE_FUTURE_DATE' } } });
    });

    it('a period register on the same date never replaces the day register', async () => {
      const sessionRepo = dataSource.getRepository(AttendanceSession);
      await sessionRepo.save({
        tenant_id: TENANT_ID,
        section_id: sectionId,
        date: TODAY(),
        period_no: null,
        state: AttendanceSessionState.FINALIZED,
      });
      // Created after the day register so an unfiltered Map would keep this one.
      await sessionRepo.save({
        tenant_id: TENANT_ID,
        section_id: sectionId,
        date: TODAY(),
        period_no: 1,
        state: AttendanceSessionState.DRAFT,
      });
      const item = (await adminList(TODAY())).find((x) => x.section_id === sectionId)!;
      expect(item.today?.state).toBe(AttendanceSessionState.FINALIZED);
    });

    it('putRegister refuses a day that is a holiday for this section class only', async () => {
      const other = await makeOtherClassSection();
      await classScopedHoliday(TODAY(), [classId]);
      await expect(service.putRegister(putParams({ dto: basePutDto() }))).rejects.toMatchObject({
        response: { details: { code: 'ATTENDANCE_NON_WORKING_DAY' } },
      });
      // The other class can still be marked the same day.
      await dataSource.getRepository(Student).save({
        full_name: 'Other Student',
        registration_number: 'ATT-REG-OTH',
        roll_number: 1,
        class_section_id: other.sectionId,
        tenant_id: TENANT_ID,
      });
      const stu = await dataSource
        .getRepository(Student)
        .findOneByOrFail({ registration_number: 'ATT-REG-OTH' });
      await expect(
        service.putRegister(
          putParams({
            sectionId: other.sectionId,
            dto: basePutDto({
              entries: [{ student_id: stu.id, status: AttendanceStatus.PRESENT }],
            }),
          }),
        ),
      ).resolves.toBeDefined();
    });

    it('the register echoes the late time of the class shift, and the tenant default without one', async () => {
      const shift = await dataSource.getRepository(Shift).save({
        tenant_id: TENANT_ID,
        name: 'Day',
        day_starts_at: '12:00',
        day_ends_at: '17:00',
        sequence: 1,
      });
      await setTenantSettings(TENANT_ID, {
        weeklyOffDays: [],
        lateAfter: '09:00',
        shiftTimes: [{ shiftId: shift.id, lateAfter: '12:15', absentAfter: '14:00' }],
      });
      const regParams = {
        sectionId,
        date: TODAY(),
        periodNo: null,
        tenantId: TENANT_ID,
        role: UserRole.ADMIN,
        userId: ADMIN_USER_ID,
      };
      // No shift on the class: tenant default.
      expect((await service.getRegister(regParams)).policy.late_after).toBe('09:00');
      await dataSource.getRepository(Class).update({ id: classId }, { shift_id: shift.id });
      try {
        expect((await service.getRegister(regParams)).policy.late_after).toBe('12:15');
      } finally {
        await dataSource.getRepository(Class).update({ id: classId }, { shift_id: null });
      }
    });
  });

  // ---- #1588: period registers ------------------------------------------

  describe('period registers', () => {
    // A fixed past Wednesday; the routine fixture puts periods 1 and 2 on it.
    const PDATE = '2026-03-04';

    async function enablePeriods(enabled = true) {
      await setTenantSettings(TENANT_ID, {
        weeklyOffDays: [],
        correctionWindowDays: 2,
        allowFutureDates: false,
        periodAttendance: { enabled },
      });
    }

    function routine() {
      return seedPeriodRoutine(dataSource, {
        tenantId: TENANT_ID,
        academicYearId: SEED_ACADEMIC_YEAR_ID,
        sectionId,
        date: PDATE,
        periods: 2,
        createdBy: ADMIN_USER_ID,
      });
    }

    const periodGet = (periodNo: number | null, date = PDATE) =>
      service.getRegister({
        sectionId,
        date,
        periodNo,
        tenantId: TENANT_ID,
        role: UserRole.ADMIN,
        userId: ADMIN_USER_ID,
      });

    const periodPut = (periodNo: number, over: Record<string, unknown> = {}) =>
      service.putRegister(
        putParams({ dto: basePutDto({ date: PDATE, period_no: periodNo, ...over }) }),
      );

    const disabledCode = { response: { details: { code: 'ATTENDANCE_PERIOD_DISABLED' } } };

    it('switch off: get, put and finalize with a period_no are 403; the day register is unaffected', async () => {
      await routine();
      // The switch is off by default (beforeEach settings have no periodAttendance).
      await expect(periodGet(1)).rejects.toMatchObject(disabledCode);
      await expect(periodPut(1)).rejects.toMatchObject(disabledCode);
      await expect(
        service.finalize({
          sectionId,
          tenantId: TENANT_ID,
          role: UserRole.ADMIN,
          userId: ADMIN_USER_ID,
          date: PDATE,
          periodNo: 1,
          ip: null,
          userAgent: null,
        }),
      ).rejects.toMatchObject(disabledCode);
      // No period session was created, and the day register still works.
      expect(await dataSource.getRepository(AttendanceSession).count()).toBe(0);
      await expect(
        service.putRegister(putParams({ dto: basePutDto({ date: PDATE }) })),
      ).resolves.toBeDefined();
    });

    it('switch off: correcting a period record is 403, correcting a day record is not', async () => {
      await routine();
      await enablePeriods(true);
      const put = await periodPut(1);
      const periodRecordId = put.students[0].record_id!;
      const day = await service.putRegister(putParams({ dto: basePutDto({ date: PDATE }) }));
      const dayRecordId = day.students[0].record_id!;
      await enablePeriods(false);
      const correct = (recordId: string) =>
        service.correctRecord({
          recordId,
          tenantId: TENANT_ID,
          role: UserRole.ADMIN,
          userId: ADMIN_USER_ID,
          dto: { status: AttendanceStatus.LATE, reason: 'fixing it' } as any,
          ip: null,
          userAgent: null,
        });
      await expect(correct(periodRecordId)).rejects.toMatchObject(disabledCode);
      await expect(correct(dayRecordId)).resolves.toBeDefined();
    });

    const history = (recordId: string, role: string = UserRole.ADMIN, userId = ADMIN_USER_ID) =>
      service.getRecordHistory({ recordId, tenantId: TENANT_ID, role, userId, query: {} as any });

    async function makeSubstitute(r: Awaited<ReturnType<typeof routine>>) {
      const user = await dataSource.getRepository(User).save({
        email: `att-sub-${randomUUID()}@test.com`,
        full_name: 'Substitute Teacher',
      });
      const teacher = await dataSource.getRepository(Teacher).save({
        user_id: user.id,
        employee_id: `ATT-SUB-${randomUUID().slice(0, 8)}`,
        tenant_id: TENANT_ID,
        designations: [],
      });
      await r.substitute(0, teacher.id); // covers period 1 on PDATE only
      return user.id;
    }

    it('switch off: a period record history is 403, a day record history is not', async () => {
      await routine();
      await enablePeriods(true);
      const periodRecordId = (await periodPut(1)).students[0].record_id!;
      const day = await service.putRegister(putParams({ dto: basePutDto({ date: PDATE }) }));
      await enablePeriods(false);
      await expect(history(periodRecordId)).rejects.toMatchObject(disabledCode);
      await expect(history(day.students[0].record_id!)).resolves.toBeDefined();
    });

    it("that period's substitute can PUT, finalize and read history; not another period", async () => {
      const r = await routine();
      await enablePeriods();
      const subUserId = await makeSubstitute(r);
      const asSub = { role: UserRole.TEACHER, userId: subUserId };
      const put = await service.putRegister(
        putParams({ ...asSub, dto: basePutDto({ date: PDATE, period_no: 1 }) }),
      );
      const finalized = await service.finalize({
        sectionId,
        tenantId: TENANT_ID,
        ...asSub,
        date: PDATE,
        periodNo: 1,
        ip: null,
        userAgent: null,
      });
      expect(finalized.session.state).toBe(AttendanceSessionState.FINALIZED);
      await expect(
        history(put.students[0].record_id!, UserRole.TEACHER, subUserId),
      ).resolves.toBeDefined();
      await expect(
        service.putRegister(
          putParams({ ...asSub, dto: basePutDto({ date: PDATE, period_no: 2 }) }),
        ),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    const notScheduled = { response: { details: { code: 'ATTENDANCE_PERIOD_NOT_SCHEDULED' } } };

    it('rejects creating a period register on a DRAFT routine with 400', async () => {
      await enablePeriods();
      await seedPeriodRoutine(dataSource, {
        tenantId: TENANT_ID,
        academicYearId: SEED_ACADEMIC_YEAR_ID,
        sectionId,
        date: PDATE,
        periods: 2,
        createdBy: ADMIN_USER_ID,
        state: RoutineState.DRAFT,
      });
      await expect(periodPut(1)).rejects.toMatchObject(notScheduled);
    });

    it('rejects creating a period register on a cancelled slot with 400', async () => {
      const r = await routine();
      await enablePeriods();
      await r.cancel(0);
      await expect(periodPut(1)).rejects.toMatchObject(notScheduled);
      await expect(periodPut(2)).resolves.toBeDefined();
    });

    it('an existing period draft stays writable after its slot is cancelled or the routine unpublished', async () => {
      const r = await routine();
      await enablePeriods();
      const first = await periodPut(1);
      await r.cancel(0);
      const second = await periodPut(1, {
        base_version: first.session.version,
        reason: 'late save',
      });
      await dataSource
        .getRepository(Routine)
        .update({ id: r.routine.id }, { state: RoutineState.DRAFT });
      const third = await periodPut(1, {
        base_version: second.session.version,
        reason: 'offline replay',
      });
      expect(third.session.version).toBe(second.session.version + 1);
      const finalized = await service.finalize({
        sectionId,
        tenantId: TENANT_ID,
        role: UserRole.ADMIN,
        userId: ADMIN_USER_ID,
        date: PDATE,
        periodNo: 1,
        ip: null,
        userAgent: null,
      });
      expect(finalized.session.state).toBe(AttendanceSessionState.FINALIZED);
    });

    it('rejects a period the routine does not schedule that day with 400', async () => {
      await routine();
      await enablePeriods();
      await expect(periodPut(5)).rejects.toMatchObject({
        response: { details: { code: 'ATTENDANCE_PERIOD_NOT_SCHEDULED' } },
      });
      // A date the routine has no slot on.
      await expect(periodPut(1, { date: '2026-03-05' })).rejects.toMatchObject({
        response: { details: { code: 'ATTENDANCE_PERIOD_NOT_SCHEDULED' } },
      });
    });

    it('snapshots the slot subject onto the session and keeps it when the routine changes', async () => {
      const r = await routine();
      await enablePeriods();
      const first = await periodPut(1);
      const session = await dataSource
        .getRepository(AttendanceSession)
        .findOneByOrFail({ id: first.session.id! });
      expect(session.subject_id).toBe(r.slots[0].subject.id);

      // The routine slot's subject changes; a later save must not touch the snapshot.
      const other = r.slots[1].subject;
      await dataSource
        .getRepository(RoutineSlot)
        .update({ id: r.slots[0].routineSlot.id }, { subject_id: other.id });
      await periodPut(1, { base_version: first.session.version, reason: 'routine change' });
      const after = await dataSource
        .getRepository(AttendanceSession)
        .findOneByOrFail({ id: first.session.id! });
      expect(after.subject_id).toBe(r.slots[0].subject.id);
    });

    it('prefills suggested_status from the day register: ABSENT and LEAVE only', async () => {
      await routine();
      await enablePeriods();
      await service.putRegister(
        putParams({
          dto: basePutDto({
            date: PDATE,
            entries: [
              { student_id: studentId1, status: AttendanceStatus.ABSENT },
              { student_id: studentId2, status: AttendanceStatus.LEAVE },
            ],
          }),
        }),
      );
      const reg = await periodGet(1);
      const by = Object.fromEntries(reg.students.map((s) => [s.student_id, s.suggested_status]));
      expect(by[studentId1]).toBe(AttendanceStatus.ABSENT);
      expect(by[studentId2]).toBe(AttendanceStatus.LEAVE);
      // Read-only: reading the period register wrote nothing.
      expect(reg.session.id).toBeNull();
      // The day register itself never carries a suggestion.
      expect((await periodGet(null)).students.every((s) => s.suggested_status === null)).toBe(true);
    });

    it('a PRESENT or LATE day mark suggests nothing, and no day register means all null', async () => {
      await routine();
      await enablePeriods();
      expect((await periodGet(1)).students.every((s) => s.suggested_status === null)).toBe(true);
      await service.putRegister(
        putParams({
          dto: basePutDto({
            date: PDATE,
            entries: [
              { student_id: studentId1, status: AttendanceStatus.PRESENT },
              { student_id: studentId2, status: AttendanceStatus.LATE },
            ],
          }),
        }),
      );
      expect((await periodGet(1)).students.every((s) => s.suggested_status === null)).toBe(true);
    });

    it('listPeriods: periods with state, [] when the switch is off', async () => {
      await routine();
      const params = {
        sectionId,
        date: PDATE,
        tenantId: TENANT_ID,
        role: UserRole.ADMIN,
        userId: ADMIN_USER_ID,
      };
      expect(await service.listPeriods(params)).toEqual([]);
      await enablePeriods();
      await periodPut(2);
      const list = await service.listPeriods(params);
      expect(list.map((p) => [p.period_no, p.state])).toEqual([
        [1, null],
        [2, AttendanceSessionState.DRAFT],
      ]);
      expect(list[0].subject_name).toMatch(/^Subject /);
    });
  });
});

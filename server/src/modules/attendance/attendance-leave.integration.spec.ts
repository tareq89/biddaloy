import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import { NotFoundException } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { DataSource, IsNull } from 'typeorm';
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
import { AttendanceSession } from './entities/attendance-session.entity';
import { AttendanceRecord } from './entities/attendance-record.entity';
import { AuditLog } from '../audit/entities/audit-log.entity';
import { CalendarEvent } from '../calendar/entities/calendar-event.entity';
import { CalendarEventClass } from '../calendar/entities/calendar-event-class.entity';
import {
  AttendanceSessionState,
  AttendanceSource,
  AttendanceStatus,
  AuditAction,
  UserRole,
} from '@biddaloy/shared';

/**
 * `markLeaveRange` / `revertLeaveRange`: an approved student leave written into
 * (and taken back out of) the whole-day registers. Real DB; every call runs in
 * a `dataSource.transaction`, as the leave-application service will call it.
 * Transactional tables are truncated before each test, so the roster is
 * re-created in `beforeEach`.
 */
describe('AttendanceService leave range (integration)', () => {
  let service: AttendanceService;
  let dataSource: DataSource;

  const TENANT_ID = SEED_TENANT_ID;
  const OTHER_TENANT = '00000000-0000-4000-8000-000000000099';
  const ACTOR = SEED_ADMIN_USER_ID;
  const APP_ID = '00000000-0000-4000-8000-0000000000a1';
  // A fixed past Wednesday inside the seed academic year (routine fixture date).
  const PAST = '2026-03-04';

  let yearId: string;
  let classId: string;
  let sectionId: string;
  let otherTenantStudentId: string;
  let studentId: string;
  let otherStudentId: string;

  function addDays(days: number): string {
    const d = new Date();
    d.setUTCDate(d.getUTCDate() + days);
    return d.toISOString().slice(0, 10);
  }

  const run = <T>(fn: (m: import('typeorm').EntityManager) => Promise<T>) =>
    dataSource.transaction(fn);

  const mark = (from: string, to: string, student = studentId) =>
    run((m) =>
      service.markLeaveRange(m, {
        tenantId: TENANT_ID,
        studentId: student,
        from,
        to,
        actorUserId: ACTOR,
        applicationId: APP_ID,
      }),
    );

  const revert = (from: string, to: string) =>
    run((m) =>
      service.revertLeaveRange(m, {
        tenantId: TENANT_ID,
        studentId,
        from,
        to,
        actorUserId: ACTOR,
        applicationId: APP_ID,
      }),
    );

  async function daySession(date: string) {
    return dataSource.getRepository(AttendanceSession).findOne({
      where: { tenant_id: TENANT_ID, section_id: sectionId, date, period_no: IsNull() },
    });
  }

  async function seedMark(
    date: string,
    status: AttendanceStatus,
    source = AttendanceSource.TEACHER,
    student = studentId,
    state = AttendanceSessionState.DRAFT,
  ) {
    const sessionRepo = dataSource.getRepository(AttendanceSession);
    let session = await sessionRepo
      .createQueryBuilder('s')
      .where('s.tenant_id = :t AND s.section_id = :sec AND s.date = :d AND s.period_no IS NULL', {
        t: TENANT_ID,
        sec: sectionId,
        d: date,
      })
      .getOne();
    if (!session) {
      session = await sessionRepo.save({
        tenant_id: TENANT_ID,
        section_id: sectionId,
        date,
        period_no: null,
        state,
        source: AttendanceSource.TEACHER,
      });
    }
    return dataSource.getRepository(AttendanceRecord).save({
      tenant_id: TENANT_ID,
      session_id: session.id,
      student_id: student,
      date,
      status,
      source,
      recorded_by_user_id: ACTOR,
    });
  }

  const recordsOn = (date: string, student = studentId) =>
    dataSource
      .getRepository(AttendanceRecord)
      .find({ where: { tenant_id: TENANT_ID, student_id: student, date } });

  const auditCount = () =>
    dataSource.getRepository(AuditLog).count({
      where: { tenant_id: TENANT_ID, entity_type: 'AttendanceRecord' },
    });

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
    const year = await dataSource.getRepository(AcademicYear).save({
      name: 'Leave Range Test Year',
      start_date: '2026-01-01',
      end_date: '2026-12-31',
      tenant_id: TENANT_ID,
    });
    const klass = await dataSource.getRepository(Class).save({
      name: 'Leave Test Class',
      academic_year_id: year.id,
      tenant_id: TENANT_ID,
    });
    const section = await dataSource.getRepository(ClassSection).save({
      section_name: 'Leave Section',
      class_id: klass.id,
      tenant_id: TENANT_ID,
    });
    yearId = year.id;
    classId = klass.id;
    sectionId = section.id;

    const otherYear = await dataSource.getRepository(AcademicYear).save({
      name: 'Leave Other Tenant Year',
      start_date: '2026-01-01',
      end_date: '2026-12-31',
      tenant_id: OTHER_TENANT,
    });
    const otherClass = await dataSource.getRepository(Class).save({
      name: 'Leave Other Class',
      academic_year_id: otherYear.id,
      tenant_id: OTHER_TENANT,
    });
    const otherSection = await dataSource.getRepository(ClassSection).save({
      section_name: 'Leave Other Sec',
      class_id: otherClass.id,
      tenant_id: OTHER_TENANT,
    });
    // Students are truncated per test, so the other-tenant one is made in beforeEach.
    void otherSection;
  }, 60000);

  afterAll(async () => {
    if (dataSource) await dataSource.destroy();
  });

  beforeEach(async () => {
    // No weekly off: every day is a working day unless a holiday says otherwise.
    await dataSource
      .getRepository(School)
      .update(
        { id: TENANT_ID },
        { settings: { version: 1, attendance: { weeklyOffDays: [] } } as any },
      );
    const repo = dataSource.getRepository(Student);
    studentId = (
      await repo.save({
        full_name: 'Leave Student',
        registration_number: 'LV-REG-1',
        roll_number: 1,
        class_section_id: sectionId,
        tenant_id: TENANT_ID,
      })
    ).id;
    otherStudentId = (
      await repo.save({
        full_name: 'Other Student',
        registration_number: 'LV-REG-2',
        roll_number: 2,
        class_section_id: sectionId,
        tenant_id: TENANT_ID,
      })
    ).id;
    const otherSection = await dataSource
      .getRepository(ClassSection)
      .findOneByOrFail({ tenant_id: OTHER_TENANT, section_name: 'Leave Other Sec' });
    otherTenantStudentId = (
      await repo.save({
        full_name: 'Tenant B Student',
        registration_number: 'LV-REG-B',
        roll_number: 1,
        class_section_id: otherSection.id,
        tenant_id: OTHER_TENANT,
      })
    ).id;
  });

  describe('markLeaveRange', () => {
    it('writes LEAVE/SYSTEM for an unmarked past day and creates the session', async () => {
      const result = await mark(PAST, PAST);
      expect(result.dates).toEqual([PAST]);

      const session = await daySession(PAST);
      expect(session).not.toBeNull();
      expect(session!.source).toBe(AttendanceSource.SYSTEM);
      const recs = await recordsOn(PAST);
      expect(recs).toHaveLength(1);
      expect(recs[0].status).toBe(AttendanceStatus.LEAVE);
      expect(recs[0].source).toBe(AttendanceSource.SYSTEM);
      expect(recs[0].recorded_by_user_id).toBe(ACTOR);
    });

    it('turns ABSENT into LEAVE with one audit row carrying application_id', async () => {
      await seedMark(PAST, AttendanceStatus.ABSENT);
      await mark(PAST, PAST);

      expect((await recordsOn(PAST))[0].status).toBe(AttendanceStatus.LEAVE);
      expect((await recordsOn(PAST))[0].source).toBe('SYSTEM');
      const audits = await dataSource.getRepository(AuditLog).find({
        where: {
          tenant_id: TENANT_ID,
          entity_type: 'AttendanceRecord',
          action: AuditAction.UPDATE,
        },
      });
      expect(audits).toHaveLength(1);
      expect(audits[0].old_values).toMatchObject({ status: 'ABSENT' });
      expect(audits[0].new_values).toMatchObject({ status: 'LEAVE', application_id: APP_ID });
    });

    it('never overwrites PRESENT or LATE, and writes no audit for them', async () => {
      const d1 = '2026-03-04';
      const d2 = '2026-03-05';
      await seedMark(d1, AttendanceStatus.PRESENT);
      await seedMark(d2, AttendanceStatus.LATE);
      const before = await auditCount();

      await mark(d1, d2);

      expect((await recordsOn(d1))[0].status).toBe(AttendanceStatus.PRESENT);
      expect((await recordsOn(d2))[0].status).toBe(AttendanceStatus.LATE);
      expect(await auditCount()).toBe(before);
    });

    it('writes LEAVE on a future day with no policy check', async () => {
      const future = addDays(5);
      await mark(future, future);
      expect((await recordsOn(future))[0].status).toBe(AttendanceStatus.LEAVE);
    });

    it('writes into a FINALIZED day and bumps its version', async () => {
      await seedMark(
        PAST,
        AttendanceStatus.ABSENT,
        AttendanceSource.TEACHER,
        studentId,
        AttendanceSessionState.FINALIZED,
      );
      const before = (await daySession(PAST))!.version;
      await mark(PAST, PAST);
      expect((await recordsOn(PAST))[0].status).toBe(AttendanceStatus.LEAVE);
      expect((await daySession(PAST))!.version).toBe(before + 1);
    });

    it('skips a holiday scoped to the student class, not one scoped to another class', async () => {
      const d1 = '2026-03-04';
      const d2 = '2026-03-05';
      const other = await dataSource.getRepository(Class).save({
        name: 'Leave Elsewhere Class',
        academic_year_id: yearId,
        tenant_id: TENANT_ID,
      });
      const holiday = async (date: string, cid: string) => {
        const event = await dataSource.getRepository(CalendarEvent).save({
          tenant_id: TENANT_ID,
          academic_year_id: yearId,
          start_date: date,
          end_date: date,
          name: 'Class Break',
          counts_as_working_day: false,
          published_at: new Date(),
        });
        await dataSource
          .getRepository(CalendarEventClass)
          .save({ event_id: event.id, class_id: cid, tenant_id: TENANT_ID });
      };
      await holiday(d1, classId); // student's class: skipped
      await holiday(d2, other.id); // another class: still a working day

      const result = await mark(d1, d2);
      expect(result.dates).toEqual([d2]);
      expect(await recordsOn(d1)).toHaveLength(0);
      expect(await recordsOn(d2)).toHaveLength(1);
    });

    it('is idempotent: second run changes no rows and adds no audit', async () => {
      await seedMark(PAST, AttendanceStatus.ABSENT);
      await mark(PAST, '2026-03-06');
      const audits = await auditCount();
      const version = (await daySession(PAST))!.version;
      const rows = await dataSource.getRepository(AttendanceRecord).count();

      await mark(PAST, '2026-03-06');

      expect(await auditCount()).toBe(audits);
      expect((await daySession(PAST))!.version).toBe(version);
      expect(await dataSource.getRepository(AttendanceRecord).count()).toBe(rows);
    });

    it('does not abort when the session row already exists (insert-orIgnore)', async () => {
      // Another transaction created the whole-day session first.
      await dataSource.getRepository(AttendanceSession).save({
        tenant_id: TENANT_ID,
        section_id: sectionId,
        date: PAST,
        period_no: null,
        source: AttendanceSource.TEACHER,
        state: AttendanceSessionState.DRAFT,
      });
      await expect(mark(PAST, PAST)).resolves.toEqual({ dates: [PAST] });
      const sessions = await dataSource
        .getRepository(AttendanceSession)
        .count({ where: { tenant_id: TENANT_ID, section_id: sectionId, date: PAST } });
      expect(sessions).toBe(1);
    });

    it('D36: a period register for that day suggests LEAVE', async () => {
      await dataSource.getRepository(School).update(
        { id: TENANT_ID },
        {
          settings: {
            version: 1,
            attendance: { weeklyOffDays: [], periodAttendance: { enabled: true } },
          } as any,
        },
      );
      await seedPeriodRoutine(dataSource, {
        tenantId: TENANT_ID,
        academicYearId: SEED_ACADEMIC_YEAR_ID,
        sectionId,
        date: PAST,
        periods: 2,
        createdBy: ACTOR,
      });
      await mark(PAST, PAST);

      const reg = await service.getRegister({
        sectionId,
        date: PAST,
        periodNo: 1,
        tenantId: TENANT_ID,
        role: UserRole.ADMIN,
        userId: ACTOR,
      });
      const row = reg.students.find((s) => s.student_id === studentId)!;
      expect(row.status).toBeNull();
      expect(row.suggested_status).toBe(AttendanceStatus.LEAVE);
    });

    it('tenant isolation: another tenant student is NotFound and nothing is written', async () => {
      await expect(mark(PAST, PAST, otherTenantStudentId)).rejects.toBeInstanceOf(
        NotFoundException,
      );
      expect(await dataSource.getRepository(AttendanceRecord).count()).toBe(0);
      expect(await dataSource.getRepository(AttendanceSession).count()).toBe(0);
    });
  });

  describe('revertLeaveRange', () => {
    it('removes future SYSTEM LEAVE only; past days and TEACHER LEAVE stay', async () => {
      const future1 = addDays(3);
      const future2 = addDays(4);
      await mark(PAST, PAST);
      await mark(future1, future1);
      await seedMark(future2, AttendanceStatus.LEAVE, AttendanceSource.TEACHER);
      // Another student's SYSTEM leave must survive too.
      await mark(future1, future1, otherStudentId);

      const result = await revert(PAST, future2);

      expect(result.dates).toEqual([future1]);
      expect(await recordsOn(PAST)).toHaveLength(1);
      expect(await recordsOn(future1)).toHaveLength(0);
      expect(await recordsOn(future2)).toHaveLength(1);
      expect(await recordsOn(future1, otherStudentId)).toHaveLength(1);
      const audits = await dataSource.getRepository(AuditLog).count({
        where: {
          tenant_id: TENANT_ID,
          action: AuditAction.DELETE,
          entity_type: 'AttendanceRecord',
        },
      });
      expect(audits).toBe(1);
    });
  });
});

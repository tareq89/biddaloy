import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import { ConfigModule } from '@nestjs/config';
import { DataSource, EntityManager } from 'typeorm';
import { getDataSourceToken } from '@nestjs/typeorm';
import {
  ApplicationStatus,
  ApplicationType,
  AttendanceSessionState,
  AttendanceSource,
  AttendanceStatus,
  AuditAction,
} from '@biddaloy/shared';
import { createTestModule } from '@test/helpers/module.helper';
import { ALL_ENTITIES } from '@test/all-entities';
import { SEED_ADMIN_USER_ID, SEED_TENANT_ID } from '@test/constants';
import { ApplicationsModule } from '../applications.module';
import { AuthModule } from '../../auth/auth.module';
import { StudentLeaveHandler } from './student-leave.handler';
import { Application } from '../entities/application.entity';
import type { ApplicationEffectContext } from '../application-types';
import { School } from '../../schools/entities/school.entity';
import { AcademicYear } from '../../academics/entities/academic-year.entity';
import { Class } from '../../academics/entities/class.entity';
import { ClassSection } from '../../academics/entities/class-section.entity';
import { AuditLog } from '../../audit/entities/audit-log.entity';
import { CalendarEvent } from '../../calendar/entities/calendar-event.entity';
import { Student } from '../../students/entities/student.entity';
import { AttendanceSession } from '../../attendance/entities/attendance-session.entity';
import { AttendanceRecord } from '../../attendance/entities/attendance-record.entity';

/**
 * [52.3.2] STUDENT_LEAVE handler against a real DB. Calls run inside a
 * `dataSource.transaction`, as the decision service will. Dates are relative to
 * today so the future/past rule of the revert is exercised for real.
 */
describe('StudentLeaveHandler (integration)', () => {
  let handler: StudentLeaveHandler;
  let dataSource: DataSource;

  const TENANT_ID = SEED_TENANT_ID;
  const OTHER_TENANT = '00000000-0000-4000-8000-000000000097';
  const ctx = { tenantId: TENANT_ID, actorUserId: SEED_ADMIN_USER_ID } as ApplicationEffectContext;
  let sectionId: string;
  let otherSectionId: string;
  let studentId: string;
  let serial = 0;

  const day = (offset: number) => {
    const d = new Date();
    d.setUTCDate(d.getUTCDate() + offset);
    return d.toISOString().slice(0, 10);
  };
  const run = <T>(fn: (m: EntityManager) => Promise<T>) => dataSource.transaction(fn);

  async function makeApp(
    start: string,
    end: string,
    opts: { student?: string; status?: ApplicationStatus; tenantId?: string } = {},
  ) {
    return dataSource.getRepository(Application).save({
      tenant_id: opts.tenantId ?? TENANT_ID,
      type: ApplicationType.STUDENT_LEAVE,
      status: opts.status ?? ApplicationStatus.PENDING,
      serial_year: 2026,
      serial_no: ++serial,
      applicant_user_id: SEED_ADMIN_USER_ID,
      subject_student_id: opts.student ?? studentId,
      start_date: start,
      end_date: end,
      payload: { reason_kind: 'ILLNESS', start_date: start, end_date: end, details: 'Fever' },
      letter_text: 'x',
      letter_locale: 'en',
    });
  }

  const apply = (app: Application) => run((m) => handler.apply(m, app, ctx));
  const cancel = (app: Application) => run((m) => handler.cancel(m, app, ctx));

  async function seedMark(
    date: string,
    status: AttendanceStatus,
    source = AttendanceSource.TEACHER,
    student = studentId,
    section = sectionId,
    tenant = TENANT_ID,
  ) {
    const sessionRepo = dataSource.getRepository(AttendanceSession);
    let session = await sessionRepo
      .createQueryBuilder('s')
      .where('s.tenant_id = :t AND s.section_id = :sec AND s.date = :d AND s.period_no IS NULL', {
        t: tenant,
        sec: section,
        d: date,
      })
      .getOne();
    if (!session) {
      session = await sessionRepo.save({
        tenant_id: tenant,
        section_id: section,
        date,
        period_no: null,
        state: AttendanceSessionState.DRAFT,
        source: AttendanceSource.TEACHER,
      });
    }
    return dataSource.getRepository(AttendanceRecord).save({
      tenant_id: tenant,
      session_id: session.id,
      student_id: student,
      date,
      status,
      source,
      recorded_by_user_id: SEED_ADMIN_USER_ID,
    });
  }

  const recordsOf = (student = studentId) =>
    dataSource
      .getRepository(AttendanceRecord)
      .find({ where: { student_id: student }, order: { date: 'ASC' } });

  beforeAll(async () => {
    const module = await createTestModule(
      ALL_ENTITIES,
      [],
      [ConfigModule.forRoot({ isGlobal: true }), ApplicationsModule, AuthModule],
    );
    handler = module.get(StudentLeaveHandler);
    dataSource = module.get<DataSource>(getDataSourceToken());

    const schoolRepo = dataSource.getRepository(School);
    if (!(await schoolRepo.findOne({ where: { id: OTHER_TENANT } }))) {
      await schoolRepo.save({
        id: OTHER_TENANT,
        name: 'Other School StL',
        slug: 'other-school-stl',
      });
    }
    const make = async (tenant: string, label: string) => {
      const year = await dataSource.getRepository(AcademicYear).save({
        name: `StL Year ${label}`,
        start_date: '2020-01-01',
        end_date: '2040-12-31',
        tenant_id: tenant,
      });
      const klass = await dataSource
        .getRepository(Class)
        .save({ name: `StL Class ${label}`, academic_year_id: year.id, tenant_id: tenant });
      return (
        await dataSource
          .getRepository(ClassSection)
          .save({ section_name: `StL Sec ${label}`, class_id: klass.id, tenant_id: tenant })
      ).id;
    };
    sectionId = await make(TENANT_ID, 'A');
    otherSectionId = await make(OTHER_TENANT, 'B');
  }, 60000);

  afterAll(async () => {
    if (dataSource) await dataSource.destroy();
  });

  beforeEach(async () => {
    for (const t of [TENANT_ID, OTHER_TENANT]) {
      await dataSource.query(`DELETE FROM applications WHERE tenant_id = $1`, [t]);
    }
    // No weekly off: every day is a working day unless a test says otherwise.
    await dataSource.getRepository(School).update(
      { id: TENANT_ID },
      {
        settings: {
          version: 1,
          region: { timezone: 'UTC' },
          attendance: { weeklyOffDays: [] },
        } as any,
      },
    );
    studentId = (
      await dataSource.getRepository(Student).save({
        full_name: 'Leave Student',
        registration_number: `STL-${Date.now()}-${Math.random()}`,
        roll_number: 1,
        class_section_id: sectionId,
        tenant_id: TENANT_ID,
      })
    ).id;
  });

  it('apply: ABSENT becomes LEAVE, PRESENT is kept, unmarked day gets LEAVE; effect_result shape', async () => {
    await seedMark(day(10), AttendanceStatus.ABSENT);
    await seedMark(day(11), AttendanceStatus.PRESENT);
    const res = await apply(await makeApp(day(10), day(12)));

    expect(res).toEqual({ days: 3, attendance_dates: [day(10), day(11), day(12)] });
    const byDate = Object.fromEntries((await recordsOf()).map((r) => [r.date, r.status]));
    expect(byDate).toEqual({
      [day(10)]: AttendanceStatus.LEAVE,
      [day(11)]: AttendanceStatus.PRESENT,
      [day(12)]: AttendanceStatus.LEAVE,
    });
    // ABSENT -> LEAVE leaves an audit row.
    const absentId = (await recordsOf()).find((r) => r.date === day(10))!.id;
    const audit = await dataSource.getRepository(AuditLog).findOneByOrFail({
      tenant_id: TENANT_ID,
      entity_type: 'AttendanceRecord',
      entity_id: absentId,
      action: AuditAction.UPDATE,
    });
    expect(audit.old_values).toMatchObject({ status: 'ABSENT' });
  });

  it('period-mode school: LEAVE goes in the whole-day register (period_no NULL), no period sessions', async () => {
    await dataSource.getRepository(School).update(
      { id: TENANT_ID },
      {
        settings: {
          version: 1,
          region: { timezone: 'UTC' },
          attendance: { weeklyOffDays: [], periodAttendance: { enabled: true } },
        } as any,
      },
    );
    await apply(await makeApp(day(10), day(10)));
    const sessions = await dataSource
      .getRepository(AttendanceSession)
      .find({ where: { tenant_id: TENANT_ID, section_id: sectionId } });
    expect(sessions).toHaveLength(1);
    expect(sessions[0].period_no).toBeNull();
  });

  it('zero working days: 422 LEAVE_NO_WORKING_DAYS and no marks', async () => {
    const off = new Date(`${day(10)}T00:00:00Z`).getUTCDay();
    await dataSource.getRepository(School).update(
      { id: TENANT_ID },
      {
        settings: {
          version: 1,
          region: { timezone: 'UTC' },
          attendance: { weeklyOffDays: [off] },
        } as any,
      },
    );
    await expect(apply(await makeApp(day(10), day(10)))).rejects.toMatchObject({
      status: 422,
      response: { details: { code: 'LEAVE_NO_WORKING_DAYS' } },
    });
    expect(await recordsOf()).toHaveLength(0);
  });

  it('a holiday inside the range is not marked and not counted', async () => {
    const year = await dataSource
      .getRepository(AcademicYear)
      .findOneByOrFail({ tenant_id: TENANT_ID, name: 'StL Year A' });
    await dataSource.getRepository(CalendarEvent).save({
      tenant_id: TENANT_ID,
      academic_year_id: year.id,
      start_date: day(11),
      end_date: day(11),
      name: 'Holiday',
      counts_as_working_day: false,
      published_at: new Date(),
    });
    const res = await apply(await makeApp(day(10), day(12)));
    expect(res).toEqual({ days: 2, attendance_dates: [day(10), day(12)] });
  });

  it('a weekly off-day inside the range is not marked and not counted', async () => {
    const off = new Date(`${day(11)}T00:00:00Z`).getUTCDay();
    await dataSource.getRepository(School).update(
      { id: TENANT_ID },
      {
        settings: {
          version: 1,
          region: { timezone: 'UTC' },
          attendance: { weeklyOffDays: [off] },
        } as any,
      },
    );
    const res = await apply(await makeApp(day(10), day(12)));
    expect(res).toEqual({ days: 2, attendance_dates: [day(10), day(12)] });
  });

  it('overlap with an approved leave: 409 LEAVE_OVERLAP; adjacent days are fine', async () => {
    await makeApp(day(10), day(12), { status: ApplicationStatus.APPROVED });
    await expect(apply(await makeApp(day(12), day(14)))).rejects.toMatchObject({
      status: 409,
      response: { details: { code: 'LEAVE_OVERLAP' } },
    });
    await expect(apply(await makeApp(day(13), day(14)))).resolves.toMatchObject({ days: 2 });
  });

  it('overlap with a cancelled or rejected leave does not block', async () => {
    await makeApp(day(10), day(12), { status: ApplicationStatus.CANCELLED });
    await makeApp(day(10), day(12), { status: ApplicationStatus.REJECTED });
    await expect(apply(await makeApp(day(11), day(13)))).resolves.toMatchObject({ days: 3 });
  });

  it('cancel: future SYSTEM LEAVE marks removed, past and today kept', async () => {
    const app = await makeApp(day(-2), day(2));
    await apply(app);
    await cancel(app);
    const dates = (await recordsOf()).map((r) => r.date);
    expect(dates).toEqual([day(-2), day(-1), day(0)]);
  });

  it('cancel reads the date columns, not the payload', async () => {
    const app = await makeApp(day(5), day(6));
    await apply(app);
    // Payload dates now point elsewhere; only the columns may drive the revert.
    app.payload = { ...app.payload, start_date: day(30), end_date: day(31) };
    await cancel(app);
    expect(await recordsOf()).toHaveLength(0);
  });

  it('D7: cancelling one of two leaves keeps the other leave marks', async () => {
    const a = await makeApp(day(10), day(11));
    const b = await makeApp(day(20), day(21));
    await apply(a);
    await apply(b);
    await cancel(a);
    expect((await recordsOf()).map((r) => r.date)).toEqual([day(20), day(21)]);
  });

  it('tenant isolation: another tenant keeps its marks when this one applies and cancels', async () => {
    const other = await dataSource.getRepository(Student).save({
      full_name: 'Other Tenant Student',
      registration_number: `STL-O-${Date.now()}`,
      roll_number: 1,
      class_section_id: otherSectionId,
      tenant_id: OTHER_TENANT,
    });
    await seedMark(
      day(10),
      AttendanceStatus.LEAVE,
      AttendanceSource.SYSTEM,
      other.id,
      otherSectionId,
      OTHER_TENANT,
    );
    const app = await makeApp(day(10), day(12));
    await apply(app);
    await cancel(app);
    const left = await recordsOf(other.id);
    expect(left).toHaveLength(1);
    expect(left[0].status).toBe(AttendanceStatus.LEAVE);
  });
});

import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from 'vitest';
import { ConfigModule } from '@nestjs/config';
import { DataSource, EntityManager } from 'typeorm';
import { getDataSourceToken } from '@nestjs/typeorm';
import {
  ApplicationStatus,
  ApplicationType,
  AttendanceSource,
  AttendanceStatus,
  LeaveStatus,
  LeaveType,
} from '@biddaloy/shared';
import { createTestModule } from '@test/helpers/module.helper';
import { ALL_ENTITIES } from '@test/all-entities';
import { SEED_ADMIN_USER_ID, SEED_TENANT_ID } from '@test/constants';
import { ApplicationsModule } from '../applications.module';
import { AuthModule } from '../../auth/auth.module';
import { StaffLeaveHandler } from './staff-leave.handler';
import { Application } from '../entities/application.entity';
import type { ApplicationEffectContext } from '../application-types';
import { AcademicYear } from '../../academics/entities/academic-year.entity';
import { CalendarEvent } from '../../calendar/entities/calendar-event.entity';
import { School } from '../../schools/entities/school.entity';
import { User } from '../../users/entities/user.entity';
import { StaffProfile } from '../../staff-profiles/entities/staff-profile.entity';
import { Teacher } from '../../academics/entities/teacher.entity';
import { StaffAttendanceService } from '../../staff-attendance/staff-attendance.service';
import { LeaveRecord } from '../../leave/entities/leave-record.entity';

/**
 * [52.3.2] STAFF_LEAVE handler against a real DB. Every call runs inside a
 * `dataSource.transaction`, the way the decision service will call it.
 */
describe('StaffLeaveHandler (integration)', () => {
  let handler: StaffLeaveHandler;
  let dataSource: DataSource;

  const TENANT_ID = SEED_TENANT_ID;
  const OTHER_TENANT = '00000000-0000-4000-8000-000000000098';
  const ctx = { tenantId: TENANT_ID, actorUserId: SEED_ADMIN_USER_ID } as ApplicationEffectContext;
  let profileId: string;
  let userId: string;
  let serial = 0;

  const day = (offset: number) => {
    const d = new Date();
    d.setUTCDate(d.getUTCDate() + offset);
    return d.toISOString().slice(0, 10);
  };
  const run = <T>(fn: (m: EntityManager) => Promise<T>) => dataSource.transaction(fn);

  async function makeUserProfile(tenantId: string) {
    const user = await dataSource.getRepository(User).save({
      email: `sl-${Date.now()}-${Math.random()}@test.com`,
      full_name: 'Staff Leave Test',
    });
    const profile = await dataSource.getRepository(StaffProfile).save({
      user_id: user.id,
      tenant_id: tenantId,
      employee_id: `EMP-SL-${Date.now()}-${Math.random()}`,
    });
    return { userId: user.id, profileId: profile.id };
  }

  async function makeApp(
    start: string,
    end: string,
    opts: { profile?: string; tenantId?: string; status?: ApplicationStatus } = {},
  ) {
    return dataSource.getRepository(Application).save({
      tenant_id: opts.tenantId ?? TENANT_ID,
      type: ApplicationType.STAFF_LEAVE,
      status: opts.status ?? ApplicationStatus.PENDING,
      serial_year: 2026,
      serial_no: ++serial,
      applicant_user_id: SEED_ADMIN_USER_ID,
      subject_staff_profile_id: opts.profile ?? profileId,
      payload: { leave_type: LeaveType.CASUAL, start_date: start, end_date: end, reason: 'Family' },
      letter_text: 'x',
      letter_locale: 'en',
    });
  }

  const apply = (app: Application, c = ctx) => run((m) => handler.apply(m, app, c));
  const cancel = (app: Application, reason?: string) =>
    run((m) => handler.cancel(m, app, { ...ctx, reason }));
  // Marks joined to their day (the date lives on the session).
  const marks = (profile = profileId): Promise<Array<{ date: string; status: string }>> =>
    dataSource.query(
      `SELECT to_char(s.date, 'YYYY-MM-DD') AS date, r.status
         FROM staff_attendance_records r JOIN staff_attendance_sessions s ON s.id = r.session_id
        WHERE r.staff_profile_id = $1 ORDER BY s.date`,
      [profile],
    );
  const leaveRows = (profile = profileId) =>
    dataSource.getRepository(LeaveRecord).find({ where: { staff_profile_id: profile } });

  beforeAll(async () => {
    const module = await createTestModule(
      ALL_ENTITIES,
      [],
      [ConfigModule.forRoot({ isGlobal: true }), ApplicationsModule, AuthModule],
    );
    handler = module.get(StaffLeaveHandler);
    dataSource = module.get<DataSource>(getDataSourceToken());
    const schoolRepo = dataSource.getRepository(School);
    if (!(await schoolRepo.findOne({ where: { id: OTHER_TENANT } }))) {
      await schoolRepo.save({ id: OTHER_TENANT, name: 'Other School SL', slug: 'other-school-sl' });
    }
  }, 60000);

  afterAll(async () => {
    if (dataSource) await dataSource.destroy();
  });

  beforeEach(async () => {
    for (const t of [TENANT_ID, OTHER_TENANT]) {
      await dataSource.query(`DELETE FROM applications WHERE tenant_id = $1`, [t]);
      await dataSource.query(`DELETE FROM leave_records WHERE tenant_id = $1`, [t]);
    }
    await dataSource.query(
      `DELETE FROM teachers WHERE user_id IN (SELECT user_id FROM staff_profiles WHERE tenant_id = $1)`,
      [TENANT_ID],
    );
    await dataSource.query(`DELETE FROM staff_profiles WHERE tenant_id = $1`, [TENANT_ID]);
    // No weekly off, so every day is a working day.
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
    await dataSource.query(
      `INSERT INTO leave_policies (id, tenant_id, leave_type, annual_quota_days, created_at, updated_at)
       VALUES (gen_random_uuid(), $1, 'CASUAL', 100, NOW(), NOW())
       ON CONFLICT (tenant_id, leave_type) DO UPDATE SET annual_quota_days = 100`,
      [TENANT_ID],
    );
    ({ userId, profileId } = await makeUserProfile(TENANT_ID));
  });

  it('apply: one APPROVED ledger row linked to the application, LEAVE marks per day, effect_result shape', async () => {
    const app = await makeApp(day(10), day(12));
    const res = await apply(app);

    const rows = await leaveRows();
    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe(LeaveStatus.APPROVED);
    expect(rows[0].application_id).toBe(app.id);
    expect(rows[0].days).toBe(3);
    // One mark per day, written by the leave helper exactly once.
    const m = await marks();
    expect(m).toHaveLength(3);
    expect(m.every((r) => r.status === AttendanceStatus.LEAVE)).toBe(true);
    expect(res).toEqual({
      leave_record_id: rows[0].id,
      days: 3,
      attendance_dates: [day(10), day(11), day(12)],
    });
  });

  it('apply over quota: 422 LEAVE_BALANCE_EXCEEDED and nothing is left behind', async () => {
    await dataSource.query(
      `UPDATE leave_policies SET annual_quota_days = 2 WHERE tenant_id = $1 AND leave_type = 'CASUAL'`,
      [TENANT_ID],
    );
    const app = await makeApp(day(10), day(12));
    await expect(apply(app)).rejects.toMatchObject({
      response: { details: { code: 'LEAVE_BALANCE_EXCEEDED' } },
    });
    expect(await leaveRows()).toHaveLength(0);
    expect(await marks()).toHaveLength(0);
  });

  it('quota null (unlimited): approved without a balance check', async () => {
    await dataSource.query(
      `UPDATE leave_policies SET annual_quota_days = NULL WHERE tenant_id = $1 AND leave_type = 'CASUAL'`,
      [TENANT_ID],
    );
    const res = await apply(await makeApp(day(10), day(14)));
    expect(res?.days).toBe(5);
  });

  it('teacher gets a SUBSTITUTE follow_up; office staff does not', async () => {
    const office = await apply(await makeApp(day(10), day(11)));
    expect(office).not.toHaveProperty('follow_up');

    const teacher = await dataSource.getRepository(Teacher).save({
      user_id: userId,
      employee_id: `T-SL-${Date.now()}`,
      tenant_id: TENANT_ID,
    } as any);
    const t = await apply(await makeApp(day(20), day(21)));
    expect(t?.follow_up).toEqual({
      kind: 'SUBSTITUTE',
      from: day(20),
      to: day(21),
      covered_for_teacher_id: (teacher as Teacher).id,
    });
  });

  it('overlap with an approved leave: 409 LEAVE_OVERLAP, adjacent days are fine', async () => {
    await apply(await makeApp(day(10), day(12)));
    const overlapping = await makeApp(day(12), day(14));
    await expect(apply(overlapping)).rejects.toMatchObject({
      status: 409,
      response: { details: { code: 'LEAVE_OVERLAP' } },
    });
    // Adjacent: starts the day after the first ends.
    const adjacent = await makeApp(day(13), day(14));
    await expect(apply(adjacent)).resolves.toMatchObject({ days: 2 });
  });

  it('overlap with a cancelled leave does not block', async () => {
    const first = await makeApp(day(10), day(12));
    await apply(first);
    await cancel(first);
    await expect(apply(await makeApp(day(11), day(13)))).resolves.toMatchObject({ days: 3 });
  });

  it('cancel: record CANCELLED, balance back, future SYSTEM marks gone, past and TEACHER marks kept', async () => {
    const app = await makeApp(day(-2), day(2));
    await apply(app);
    // A TEACHER-source mark on a future day must survive the revert.
    await dataSource.query(
      `UPDATE staff_attendance_records SET source = $2
        WHERE staff_profile_id = $1
          AND session_id IN (SELECT id FROM staff_attendance_sessions WHERE date = $3)`,
      [profileId, AttendanceSource.TEACHER, day(2)],
    );
    const before = await marks();
    expect(before).toHaveLength(5);

    await cancel(app, 'Changed plans');

    expect((await leaveRows())[0].status).toBe(LeaveStatus.CANCELLED);
    const dates = (await marks()).map((r) => r.date).sort();
    // today and earlier stay, tomorrow is removed, the TEACHER mark on day(2) stays
    expect(dates).toEqual([day(-2), day(-1), day(0), day(2)]);
  });

  it('D7: cancelling one of two leaves leaves the other leave marks alone', async () => {
    const a = await makeApp(day(10), day(11));
    const b = await makeApp(day(20), day(21));
    await apply(a);
    await apply(b);
    await cancel(a);
    const dates = (await marks()).map((r) => r.date).sort();
    expect(dates).toEqual([day(20), day(21)]);
  });

  it('tenant isolation: another tenant keeps its records when this one applies and cancels', async () => {
    const other = await makeUserProfile(OTHER_TENANT);
    await dataSource.getRepository(LeaveRecord).save({
      tenant_id: OTHER_TENANT,
      staff_profile_id: other.profileId,
      leave_type: LeaveType.CASUAL,
      start_date: day(10),
      end_date: day(12),
      days: 3,
      status: LeaveStatus.APPROVED,
      reason: 'x',
    });
    const app = await makeApp(day(10), day(12));
    await apply(app);
    await cancel(app);
    const otherRows = await leaveRows(other.profileId);
    expect(otherRows).toHaveLength(1);
    expect(otherRows[0].status).toBe(LeaveStatus.APPROVED);
  });

  it('cancel returns the days: quota equals the range, apply, cancel, re-apply succeeds', async () => {
    await dataSource.query(
      `UPDATE leave_policies SET annual_quota_days = 3 WHERE tenant_id = $1 AND leave_type = 'CASUAL'`,
      [TENANT_ID],
    );
    const first = await makeApp(day(10), day(12));
    await apply(first);
    await cancel(first);
    // Balance is back to 3, so the same 3 days fit again.
    await expect(apply(await makeApp(day(10), day(12)))).resolves.toMatchObject({ days: 3 });
  });

  it('a failure while marking the register rolls back the ledger row', async () => {
    const spy = vi
      .spyOn(StaffAttendanceService.prototype, 'markLeaveRange')
      .mockRejectedValueOnce(new Error('boom'));
    await expect(apply(await makeApp(day(10), day(12)))).rejects.toThrow('boom');
    spy.mockRestore();
    expect(await leaveRows()).toHaveLength(0);
  });

  it('a holiday inside the range is not marked and not counted', async () => {
    const year = await dataSource.getRepository(AcademicYear).save({
      name: 'SL Holiday Year',
      start_date: '2020-01-01',
      end_date: '2040-12-31',
      tenant_id: TENANT_ID,
    });
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
    expect(res).toMatchObject({ days: 2, attendance_dates: [day(10), day(12)] });
  });
});

import { describe, it, expect, beforeAll, beforeEach, afterEach, afterAll, vi } from 'vitest';
import { ConfigModule } from '@nestjs/config';
import { DataSource } from 'typeorm';
import { getDataSourceToken } from '@nestjs/typeorm';
import type Redis from 'ioredis';
import { createTestModule } from '@test/helpers/module.helper';
import { ALL_ENTITIES } from '@test/all-entities';
import { SEED_TENANT_ID, SEED_ADMIN_USER_ID } from '@test/constants';
import {
  AttendanceStatus,
  DashboardWidgetKey,
  LeaveStatus,
  LeaveType,
  UserRole,
  UserStatus,
} from '@biddaloy/shared';
import { StaffAttendanceModule } from './staff-attendance.module';
import { AuthModule } from '../auth/auth.module';
import { StaffAttendanceService } from './staff-attendance.service';
import { StaffAttendanceDashboardService } from './staff-attendance-dashboard.service';
import { StaffAttendanceRecord } from './entities/staff-attendance-record.entity';
import { School } from '../schools/entities/school.entity';
import { User } from '../users/entities/user.entity';
import { StaffProfile } from '../staff-profiles/entities/staff-profile.entity';
import { LeaveRecord } from '../leave/entities/leave-record.entity';
import { TENANT_STATUS_REDIS } from '../schools/tenant-status.service';
import { localToday } from '../attendance/attendance-policy.util';

/**
 * [8.10.7.2.02] "Teachers and staff" widget. Counts must equal what
 * `StaffAttendanceService.markDay` saved; leave comes from `leave_records`.
 */
describe('StaffAttendanceDashboardService (integration)', () => {
  let service: StaffAttendanceDashboardService;
  let attendance: StaffAttendanceService;
  let dataSource: DataSource;
  let redis: Redis;

  const TENANT_ID = SEED_TENANT_ID;
  const OTHER_TENANT = '00000000-0000-4000-8000-000000000097';
  const P = AttendanceStatus.PRESENT;
  const L = AttendanceStatus.LATE;
  const A = AttendanceStatus.ABSENT;
  let n = 0;

  const TODAY = () => localToday('Asia/Dhaka');
  const addDays = (d: number) => {
    const x = new Date(`${TODAY()}T00:00:00Z`);
    x.setUTCDate(x.getUTCDate() + d);
    return x.toISOString().slice(0, 10);
  };
  const widget = () => service.getToday(TENANT_ID);

  async function clearCaches() {
    const keys = await redis.keys(`tenant:*:dash:v1:${DashboardWidgetKey.STAFF_TODAY}:*`);
    if (keys.length) await redis.del(...keys);
  }

  async function makeStaff(name: string, tenantId = TENANT_ID, userOpts: Partial<User> = {}) {
    n += 1;
    const user = await dataSource.getRepository(User).save({
      email: `staff-dash-${Date.now()}-${n}@test.com`,
      full_name: name,
      ...userOpts,
    });
    return dataSource.getRepository(StaffProfile).save({
      user_id: user.id,
      tenant_id: tenantId,
      employee_id: `EMP-DASH-${Date.now()}-${n}`,
    });
  }

  async function leave(
    staffId: string,
    start: string,
    end: string,
    status = LeaveStatus.APPROVED,
    tenantId = TENANT_ID,
  ) {
    await dataSource.getRepository(LeaveRecord).save({
      tenant_id: tenantId,
      staff_profile_id: staffId,
      leave_type: LeaveType.SICK,
      start_date: start,
      end_date: end,
      days: 1,
      status,
    });
  }

  function markDay(date: string, entries: Array<[string, AttendanceStatus]>) {
    return attendance.markDay({
      tenantId: TENANT_ID,
      role: UserRole.ADMIN,
      userId: SEED_ADMIN_USER_ID,
      ip: '127.0.0.1',
      userAgent: 'vitest',
      dto: {
        date,
        entries: entries.map(([id, status]) => ({ staff_profile_id: id, status })),
      },
    } as any);
  }

  beforeAll(async () => {
    const module = await createTestModule(
      ALL_ENTITIES,
      [],
      [ConfigModule.forRoot({ isGlobal: true }), StaffAttendanceModule, AuthModule],
    );
    service = module.get(StaffAttendanceDashboardService);
    attendance = module.get(StaffAttendanceService);
    dataSource = module.get<DataSource>(getDataSourceToken());
    redis = module.get(TENANT_STATUS_REDIS);
    const schoolRepo = dataSource.getRepository(School);
    if (!(await schoolRepo.findOne({ where: { id: OTHER_TENANT } }))) {
      await schoolRepo.save({
        id: OTHER_TENANT,
        name: 'Staff Dash Other',
        slug: 'staff-dash-other',
      });
    }
  }, 60000);

  afterAll(async () => {
    if (dataSource) await dataSource.destroy();
  });

  beforeEach(async () => {
    await dataSource.getRepository(School).update(
      { id: TENANT_ID },
      {
        settings: {
          version: 1,
          region: { timezone: 'Asia/Dhaka' },
          attendance: { weeklyOffDays: [], correctionWindowDays: 2, allowFutureDates: false },
        } as any,
      },
    );
    await clearCaches();
    for (const t of [TENANT_ID, OTHER_TENANT]) {
      await dataSource.query(`DELETE FROM leave_records WHERE tenant_id = $1`, [t]);
      await dataSource.query(`DELETE FROM staff_attendance_records WHERE tenant_id = $1`, [t]);
      await dataSource.query(`DELETE FROM staff_attendance_sessions WHERE tenant_id = $1`, [t]);
      await dataSource.query(`DELETE FROM staff_profiles WHERE tenant_id = $1`, [t]);
    }
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('counts present/late/unmarked and reconciles with the rows markDay wrote', async () => {
    const [a, b, c] = [await makeStaff('S1'), await makeStaff('S2'), await makeStaff('S3')];
    await makeStaff('S4');
    await markDay(TODAY(), [
      [a.id, P],
      [b.id, P],
      [c.id, L],
    ]);
    const res = await widget();
    expect(res).toMatchObject({
      date: TODAY(),
      staff_total: 4,
      present: 2,
      late: 1,
      absent: 0,
      leave: 0,
      unmarked: 1,
    });
    const rows = await dataSource
      .getRepository(StaffAttendanceRecord)
      .createQueryBuilder('r')
      .innerJoin('r.session', 's')
      .where('r.tenant_id = :t AND s.date = :d', { t: TENANT_ID, d: TODAY() })
      .getMany();
    const count = (s: AttendanceStatus) => rows.filter((r) => r.status === s).length;
    expect([res.present, res.late, res.absent]).toEqual([count(P), count(L), count(A)]);
    expect(res.unmarked).toBe(res.staff_total - rows.length);
  });

  it('lists only APPROVED leave covering today', async () => {
    const ok = await makeStaff('Zed Approved');
    const pending = await makeStaff('Pending');
    const rejected = await makeStaff('Rejected');
    const ended = await makeStaff('Ended');
    await leave(ok.id, addDays(-1), addDays(2));
    await leave(pending.id, addDays(-1), addDays(2), LeaveStatus.PENDING);
    await leave(rejected.id, addDays(-1), addDays(2), LeaveStatus.REJECTED);
    await leave(ended.id, addDays(-3), addDays(-1));
    const res = await widget();
    expect(res.on_leave).toEqual([
      {
        staff_profile_id: ok.id,
        full_name: 'Zed Approved',
        leave_type: LeaveType.SICK,
        end_date: addDays(2),
      },
    ]);
    expect(res.leave).toBe(1);
  });

  it('buckets add up to staff_total: leave mark, unmarked on leave, overlapping leaves', async () => {
    const marked = await makeStaff('Marked Leave'); // LEAVE mark, no leave record
    const onLeave = await makeStaff('On Leave'); // approved leave, no mark, two overlapping records
    await makeStaff('Nobody');
    await leave(onLeave.id, addDays(-1), addDays(1));
    await leave(onLeave.id, TODAY(), TODAY());
    await markDay(TODAY(), [[marked.id, AttendanceStatus.LEAVE]]);
    const res = await widget();
    expect(res).toMatchObject({ staff_total: 3, leave: 2, unmarked: 1 });
    expect(res.present + res.late + res.absent + res.leave + res.unmarked).toBe(res.staff_total);
    expect(res.on_leave.map((l) => l.staff_profile_id)).toEqual([onLeave.id]);
  });

  it('orders on_leave by name', async () => {
    const z = await makeStaff('Zara');
    const m = await makeStaff('Mina');
    await leave(z.id, TODAY(), TODAY());
    await leave(m.id, TODAY(), TODAY());
    expect((await widget()).on_leave.map((l) => l.full_name)).toEqual(['Mina', 'Zara']);
  });

  it('ABSENT with approved leave is not absent_without_leave; ABSENT without is', async () => {
    const withLeave = await makeStaff('With Leave');
    const without = await makeStaff('Without');
    await leave(withLeave.id, TODAY(), TODAY());
    await markDay(TODAY(), [
      [withLeave.id, A],
      [without.id, A],
    ]);
    const res = await widget();
    expect(res.absent).toBe(2);
    expect(res.absent_without_leave).toBe(1);
  });

  it('a soft-deleted or inactive user is not in staff_total', async () => {
    await makeStaff('Active');
    await makeStaff('Deleted', TENANT_ID, { deleted_at: new Date() } as Partial<User>);
    await makeStaff('Inactive', TENANT_ID, { status: UserStatus.INACTIVE } as Partial<User>);
    const res = await widget();
    expect(res.staff_total).toBe(1);
    expect(res.unmarked).toBe(1);
  });

  it('Dhaka midnight: leave on 2026-10-08 is listed from 18:00Z on 2026-10-07, not before', async () => {
    const s = await makeStaff('Midnight');
    await leave(s.id, '2026-10-08', '2026-10-08');
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-07T17:59:00Z'));
    expect((await widget()).on_leave).toHaveLength(0);
    await clearCaches();
    vi.setSystemTime(new Date('2026-10-07T18:00:00Z'));
    expect((await widget()).on_leave).toHaveLength(1);
  });

  it('never counts another tenant', async () => {
    await makeStaff('Mine');
    const theirs = await makeStaff('Theirs', OTHER_TENANT);
    await leave(theirs.id, TODAY(), TODAY(), LeaveStatus.APPROVED, OTHER_TENANT);
    await dataSource.query(
      `INSERT INTO staff_attendance_sessions (tenant_id, date) VALUES ($1, $2)`,
      [OTHER_TENANT, TODAY()],
    );
    await dataSource.query(
      `INSERT INTO staff_attendance_records (tenant_id, session_id, staff_profile_id, status)
       SELECT $1, id, $2, 'PRESENT' FROM staff_attendance_sessions WHERE tenant_id = $1`,
      [OTHER_TENANT, theirs.id],
    );
    const res = await widget();
    expect(res).toMatchObject({ staff_total: 1, present: 0, leave: 0, unmarked: 1 });
    expect(res.on_leave).toEqual([]);
  });

  it('is cached under tenant:<id>:dash:v1:staff-today:school', async () => {
    await makeStaff('Cached');
    await widget();
    expect(
      await redis.get(`tenant:${TENANT_ID}:dash:v1:${DashboardWidgetKey.STAFF_TODAY}:school`),
    ).not.toBeNull();
  });
});

import { describe, it, expect, vi, beforeAll, beforeEach, afterEach, afterAll } from 'vitest';
import { ConfigModule } from '@nestjs/config';
import { DataSource } from 'typeorm';
import { getDataSourceToken } from '@nestjs/typeorm';
import { createTestModule } from '@test/helpers/module.helper';
import { ALL_ENTITIES } from '@test/all-entities';
import { SEED_TENANT_ID } from '@test/constants';
import { LeaveStatus, LeaveType, UserRole } from '@biddaloy/shared';
import { LeaveService } from './leave.service';
import { LeaveModule } from './leave.module';
import { AuthModule } from '../auth/auth.module';
import { School } from '../schools/entities/school.entity';
import { User } from '../users/entities/user.entity';
import { StaffProfile } from '../staff-profiles/entities/staff-profile.entity';
import { LeaveRecord } from './entities/leave-record.entity';

/** [8.10.7.3.05] "My leave balance" widget: LeaveService.getOwnBalances. */
describe('LeaveService.getOwnBalances (integration)', () => {
  let service: LeaveService;
  let dataSource: DataSource;
  const TENANT_ID = SEED_TENANT_ID;
  const OTHER_TENANT = '00000000-0000-4000-8000-000000000096';
  let userId: string;
  let profileId: string;
  const ROLE = UserRole.TEACHER;

  const setNow = (iso: string) => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(iso));
  };
  const mine = () => service.getOwnBalances(TENANT_ID, userId, ROLE);
  const leave = (type: LeaveType, start: string, end: string, days: number, status: LeaveStatus) =>
    dataSource.getRepository(LeaveRecord).save({
      tenant_id: TENANT_ID,
      staff_profile_id: profileId,
      leave_type: type,
      start_date: start,
      end_date: end,
      days,
      status,
    });

  beforeAll(async () => {
    const module = await createTestModule(
      ALL_ENTITIES,
      [],
      [ConfigModule.forRoot({ isGlobal: true }), LeaveModule, AuthModule],
    );
    service = module.get(LeaveService);
    dataSource = module.get<DataSource>(getDataSourceToken());
    const schoolRepo = dataSource.getRepository(School);
    if (!(await schoolRepo.findOne({ where: { id: OTHER_TENANT } }))) {
      await schoolRepo.save({
        id: OTHER_TENANT,
        name: 'Leave Dash Other',
        slug: 'leave-dash-other',
      });
    }
  }, 60000);

  afterAll(async () => {
    if (dataSource) await dataSource.destroy();
  });

  beforeEach(async () => {
    for (const t of [TENANT_ID, OTHER_TENANT]) {
      await dataSource.query(`DELETE FROM leave_records WHERE tenant_id = $1`, [t]);
      await dataSource.query(`DELETE FROM staff_profiles WHERE tenant_id = $1`, [t]);
    }
    await dataSource.query(
      `UPDATE schools SET settings = settings #- '{region,timezone}' WHERE id = $1`,
      [TENANT_ID],
    );
    // Every LeaveType needs a policy row; CASUAL 10 + SICK 2 = 12, the rest 0.
    for (const type of Object.values(LeaveType)) {
      const quota = type === LeaveType.CASUAL ? 10 : type === LeaveType.SICK ? 2 : 0;
      await dataSource.query(
        `INSERT INTO leave_policies (id, tenant_id, leave_type, annual_quota_days, created_at, updated_at)
         VALUES (gen_random_uuid(), $1, $2, $3, NOW(), NOW())
         ON CONFLICT (tenant_id, leave_type) DO UPDATE SET annual_quota_days = $3`,
        [TENANT_ID, type, quota],
      );
    }
    const user = await dataSource.getRepository(User).save({
      email: `leave-dash-${Date.now()}-${Math.random()}@test.com`,
      full_name: 'Leave Dash Staff',
    });
    userId = user.id;
    profileId = (
      await dataSource.getRepository(StaffProfile).save({
        user_id: userId,
        tenant_id: TENANT_ID,
        employee_id: `EMP-LD-${Date.now()}`,
      })
    ).id;
    setNow('2026-06-15T06:00:00Z');
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('12 days of quota, 4 approved this year -> 12 / 4 / 8 and by_type matches', async () => {
    await leave(LeaveType.CASUAL, '2026-02-01', '2026-02-03', 3, LeaveStatus.APPROVED);
    await leave(LeaveType.SICK, '2026-03-01', '2026-03-01', 1, LeaveStatus.APPROVED);
    const res = await mine();
    expect(res).toMatchObject({
      has_profile: true,
      year: 2026,
      total_quota_days: 12,
      total_used_days: 4,
      total_balance_days: 8,
    });
    expect(res.by_type.find((b) => b.leave_type === LeaveType.CASUAL)).toEqual({
      leave_type: LeaveType.CASUAL,
      annual_quota_days: 10,
      used_days: 3,
      balance: 7,
    });
  });

  it('PENDING and REJECTED requests do not reduce the balance', async () => {
    await leave(LeaveType.CASUAL, '2026-02-01', '2026-02-03', 3, LeaveStatus.PENDING);
    await leave(LeaveType.CASUAL, '2026-03-01', '2026-03-02', 2, LeaveStatus.REJECTED);
    const res = await mine();
    expect(res.total_used_days).toBe(0);
    expect(res.total_balance_days).toBe(12);
  });

  it('a caller without a staff profile gets has_profile false and zeros', async () => {
    const other = await dataSource
      .getRepository(User)
      .save({ email: `leave-dash-np-${Date.now()}@test.com`, full_name: 'No Profile' });
    expect(await service.getOwnBalances(TENANT_ID, other.id, ROLE)).toEqual({
      has_profile: false,
      year: 2026,
      total_quota_days: 0,
      total_used_days: 0,
      total_balance_days: 0,
      by_type: [],
    });
  });

  it('a profile for the same user in another tenant is never used', async () => {
    await dataSource.getRepository(StaffProfile).delete({ id: profileId });
    await dataSource.getRepository(StaffProfile).save({
      user_id: userId,
      tenant_id: OTHER_TENANT,
      employee_id: `EMP-LD-OTHER-${Date.now()}`,
    });
    const res = await mine();
    expect(res.has_profile).toBe(false);
    expect(res.by_type).toEqual([]);
  });

  it('by_type deep-equals getBalancesForCaller (the GET /leave/balance service)', async () => {
    await leave(LeaveType.CASUAL, '2026-02-01', '2026-02-03', 3, LeaveStatus.APPROVED);
    const res = await mine();
    expect(res.by_type).toEqual(
      await service.getBalancesForCaller(TENANT_ID, profileId, userId, ROLE),
    );
  });

  it('00:30 on 1 Jan 2027 in Dhaka reads 2027; last year leave no longer counts (#1817)', async () => {
    await leave(LeaveType.CASUAL, '2026-02-01', '2026-02-03', 3, LeaveStatus.APPROVED);
    setNow('2026-12-31T18:30:00Z');
    const res = await mine();
    expect(res.year).toBe(2027);
    expect(res.total_used_days).toBe(0);
    expect(res.total_balance_days).toBe(12);
  });
});

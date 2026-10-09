import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import { ConfigModule } from '@nestjs/config';
import { DataSource } from 'typeorm';
import { getDataSourceToken } from '@nestjs/typeorm';
import { createTestModule } from '@test/helpers/module.helper';
import { ALL_ENTITIES } from '@test/all-entities';
import { SEED_TENANT_ID, SEED_ADMIN_USER_ID } from '@test/constants';
import { LeaveService } from './leave.service';
import { LeaveModule } from './leave.module';
import { SchoolsService } from '../schools/schools.service';
import { localToday } from '../attendance/attendance-policy.util';
import { AuthModule } from '../auth/auth.module';
import { School } from '../schools/entities/school.entity';
import { User } from '../users/entities/user.entity';
import { StaffProfile } from '../staff-profiles/entities/staff-profile.entity';
import { LeaveRecord } from './entities/leave-record.entity';
import { LeavePolicy } from './entities/leave-policy.entity';
import { LeaveStatus, LeaveType } from '@biddaloy/shared';

/**
 * Integration tests for `LeaveService` against a real, migrated test
 * database — the balance formula and the approved-leave ledger writes
 * (`recordApprovedLeave` / `cancelApprovedLeave`, including their concurrent
 * races, which a mocked unit test cannot exercise). See
 * `staff-attendance.service.integration.spec.ts` for the pattern this
 * mirrors.
 */
describe('LeaveService (integration)', () => {
  let service: LeaveService;
  let schoolsService: SchoolsService;
  let dataSource: DataSource;

  const TENANT_ID = SEED_TENANT_ID;
  const ADMIN_USER_ID = SEED_ADMIN_USER_ID;
  let staffProfileId: string;
  let staffUserId: string;

  const CURRENT_YEAR = new Date().getUTCFullYear();
  const NEXT_YEAR = CURRENT_YEAR + 1;

  beforeAll(async () => {
    const module = await createTestModule(
      ALL_ENTITIES,
      [],
      [ConfigModule.forRoot({ isGlobal: true }), LeaveModule, AuthModule],
    );
    service = module.get<LeaveService>(LeaveService);
    schoolsService = module.get(SchoolsService, { strict: false });
    dataSource = module.get<DataSource>(getDataSourceToken());
  }, 60000);

  afterAll(async () => {
    if (dataSource) {
      await dataSource.destroy();
    }
  });

  beforeEach(async () => {
    // `leave_records`/`staff_profiles` aren't in the transactional-table
    // reset list, so this file clears its own tenant's rows per test,
    // matching `staff-attendance.service.integration.spec.ts`.
    await dataSource.query(`DELETE FROM leave_records WHERE tenant_id = $1`, [TENANT_ID]);
    await dataSource.query(`DELETE FROM staff_profiles WHERE tenant_id = $1`, [TENANT_ID]);
    // The seed tenant is created by test global-setup after the migration
    // ran, so it never got the migration's per-tenant D9 seed row —
    // upsert one here rather than assuming it exists.
    await dataSource.query(
      `INSERT INTO leave_policies (id, tenant_id, leave_type, annual_quota_days, created_at, updated_at)
       VALUES (gen_random_uuid(), $1, 'CASUAL', 10, NOW(), NOW())
       ON CONFLICT (tenant_id, leave_type) DO UPDATE SET annual_quota_days = 10`,
      [TENANT_ID],
    );

    const userRepo = dataSource.getRepository(User);
    const staffProfileRepo = dataSource.getRepository(StaffProfile);
    const user = await userRepo.save({
      email: `leave-${Date.now()}-${Math.random()}@test.com`,
      full_name: 'Leave Test Staff',
    });
    const profile = await staffProfileRepo.save({
      user_id: user.id,
      tenant_id: TENANT_ID,
      employee_id: `EMP-LEAVE-${Date.now()}`,
    });
    staffProfileId = profile.id;
    staffUserId = user.id;
  });

  describe('getBalance', () => {
    it(`10-day CASUAL quota, 3 approved days -> balance 7; pending/rejected do not reduce it`, async () => {
      const recordRepo = dataSource.getRepository(LeaveRecord);
      await recordRepo.save({
        tenant_id: TENANT_ID,
        staff_profile_id: staffProfileId,
        leave_type: LeaveType.CASUAL,
        start_date: `${CURRENT_YEAR}-02-01`,
        end_date: `${CURRENT_YEAR}-02-03`,
        days: 3,
        status: LeaveStatus.APPROVED,
      });
      await recordRepo.save({
        tenant_id: TENANT_ID,
        staff_profile_id: staffProfileId,
        leave_type: LeaveType.CASUAL,
        start_date: `${CURRENT_YEAR}-03-01`,
        end_date: `${CURRENT_YEAR}-03-05`,
        days: 5,
        status: LeaveStatus.PENDING,
      });
      await recordRepo.save({
        tenant_id: TENANT_ID,
        staff_profile_id: staffProfileId,
        leave_type: LeaveType.CASUAL,
        start_date: `${CURRENT_YEAR}-04-01`,
        end_date: `${CURRENT_YEAR}-04-02`,
        days: 2,
        status: LeaveStatus.REJECTED,
      });

      const balance = await service.getBalance(TENANT_ID, staffProfileId, LeaveType.CASUAL);

      expect(balance.annual_quota_days).toBe(10);
      expect(balance.used_days).toBe(3);
      expect(balance.balance).toBe(7);
    });
  });

  describe('recordApprovedLeave / cancelApprovedLeave', () => {
    // 2031-01-02 is a Thursday. Weekly off = Fri(5) + Sat(6).
    const THU = '2031-01-02';
    const SUN = '2031-01-05';
    const MON = '2031-01-06';

    async function newApplication(tenantId: string, profileId: string, userId: string) {
      const rows = await dataSource.query(
        `INSERT INTO applications (tenant_id, type, serial_year, serial_no, subject_staff_profile_id, applicant_user_id, letter_text, letter_locale)
         VALUES ($1, 'STAFF_LEAVE', 2031, $2, $3, $4, 'x', 'en') RETURNING id`,
        [tenantId, Math.floor(Math.random() * 1_000_000_000), profileId, userId],
      );
      return rows[0].id as string;
    }

    function record(applicationId: string, startDate: string, endDate: string) {
      return dataSource.transaction((manager) =>
        service.recordApprovedLeave(manager, {
          tenantId: TENANT_ID,
          staffProfileId,
          leaveType: LeaveType.CASUAL,
          startDate,
          endDate,
          reason: 'family',
          applicationId,
          approvedByUserId: ADMIN_USER_ID,
        }),
      );
    }

    async function setQuota(quota: number | null) {
      await dataSource.query(
        `UPDATE leave_policies SET annual_quota_days = $2 WHERE tenant_id = $1 AND leave_type = 'CASUAL'`,
        [TENANT_ID, quota],
      );
    }

    async function setWeeklyOff(days: number[]) {
      await dataSource
        .getRepository(School)
        .update(
          { id: TENANT_ID },
          { settings: { version: 1, attendance: { weeklyOffDays: days } } as any },
        );
    }

    beforeEach(async () => {
      await setWeeklyOff([5, 6]);
    });

    afterAll(async () => {
      await setWeeklyOff([]);
    });

    it('counts only working days (Thu-Sun with Fri/Sat off = 2) and stores application_id', async () => {
      const appId = await newApplication(TENANT_ID, staffProfileId, staffUserId);
      const result = await record(appId, THU, SUN);

      expect(result.days).toBe(2);
      expect(result.attendance_dates).toEqual([THU, SUN]);
      const row = await dataSource
        .getRepository(LeaveRecord)
        .findOneOrFail({ where: { id: result.leave_record_id } });
      expect(row.application_id).toBe(appId);
      expect(row.status).toBe(LeaveStatus.APPROVED);
    });

    it('rejects a range with no working days (422 LEAVE_NO_WORKING_DAYS)', async () => {
      const appId = await newApplication(TENANT_ID, staffProfileId, staffUserId);
      await expect(record(appId, '2031-01-03', '2031-01-04')).rejects.toMatchObject({
        response: { details: { code: 'LEAVE_NO_WORKING_DAYS' } },
      });
    });

    it('2 days on a 1-day-left quota -> 422 LEAVE_BALANCE_EXCEEDED, nothing written', async () => {
      await setQuota(1);
      const appId = await newApplication(TENANT_ID, staffProfileId, staffUserId);
      await expect(record(appId, THU, SUN)).rejects.toMatchObject({
        response: { details: { code: 'LEAVE_BALANCE_EXCEEDED' } },
      });
      expect(
        await dataSource.getRepository(LeaveRecord).count({ where: { tenant_id: TENANT_ID } }),
      ).toBe(0);
      const marks = await dataSource.query(
        `SELECT 1 FROM staff_attendance_records WHERE tenant_id = $1 AND staff_profile_id = $2`,
        [TENANT_ID, staffProfileId],
      );
      expect(marks).toHaveLength(0);
    });

    it('no policy for the type: 422 LEAVE_POLICY_MISSING (a 404 would read as "no such application")', async () => {
      await dataSource.query(
        `DELETE FROM leave_policies WHERE tenant_id = $1 AND leave_type = 'CASUAL'`,
        [TENANT_ID],
      );
      const appId = await newApplication(TENANT_ID, staffProfileId, staffUserId);
      await expect(record(appId, THU, SUN)).rejects.toMatchObject({
        status: 422,
        response: { details: { code: 'LEAVE_POLICY_MISSING' } },
      });
    });

    it('null quota (unlimited) writes the APPROVED row', async () => {
      await setQuota(null);
      const appId = await newApplication(TENANT_ID, staffProfileId, staffUserId);
      const result = await record(appId, THU, SUN);
      expect(result.days).toBe(2);
      const balance = await service.getBalance(TENANT_ID, staffProfileId, LeaveType.CASUAL);
      expect(balance.annual_quota_days).toBeNull();
      expect(balance.balance).toBeNull();
    });

    it('two parallel approvals on a 2-day-left quota (1 + 2 days): exactly one succeeds', async () => {
      await setQuota(2);
      const app1 = await newApplication(TENANT_ID, staffProfileId, staffUserId);
      const app2 = await newApplication(TENANT_ID, staffProfileId, staffUserId);
      const results = await Promise.allSettled([record(app1, SUN, SUN), record(app2, SUN, MON)]);
      expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
      expect(results.filter((r) => r.status === 'rejected')).toHaveLength(1);
    });

    it('cancelApprovedLeave -> CANCELLED, balance back; a second cancel is 422', async () => {
      const appId = await newApplication(TENANT_ID, staffProfileId, staffUserId);
      const created = await record(appId, THU, SUN);
      const cancel = () =>
        dataSource.transaction((manager) =>
          service.cancelApprovedLeave(manager, {
            tenantId: TENANT_ID,
            applicationId: appId,
            actorUserId: ADMIN_USER_ID,
            reason: 'changed plans',
          }),
        );

      const result = await cancel();
      expect(result.leave_record_id).toBe(created.leave_record_id);
      expect(result.reverted_dates).toEqual([THU, SUN]); // 2031 is in the future
      const row = await dataSource
        .getRepository(LeaveRecord)
        .findOneOrFail({ where: { id: created.leave_record_id } });
      expect(row.status).toBe(LeaveStatus.CANCELLED);
      const balance = await service.getBalance(TENANT_ID, staffProfileId, LeaveType.CASUAL);
      expect(balance.used_days).toBe(0);

      await expect(cancel()).rejects.toMatchObject({
        response: { details: { code: 'LEAVE_NOT_CANCELLABLE' } },
      });
    });

    describe('cancelling a leave that has already started', () => {
      // Dates are relative to the school's own "today" (its region timezone,
      // the same one `revertLeaveRange` uses), so these run on any date.
      async function schoolToday() {
        const settings = await schoolsService.getResolvedSettings(TENANT_ID);
        return localToday(settings.region?.timezone ?? 'UTC');
      }
      function addDays(iso: string, n: number) {
        return new Date(Date.parse(`${iso}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
      }
      function cancel(applicationId: string) {
        return dataSource.transaction((manager) =>
          service.cancelApprovedLeave(manager, {
            tenantId: TENANT_ID,
            applicationId,
            actorUserId: ADMIN_USER_ID,
            reason: 'back early',
          }),
        );
      }
      // The quota is the sum of APPROVED `days` (D31). Read it straight from
      // the table so a leave crossing 1 January does not trip the UTC-year filter.
      async function approvedDays() {
        const [row] = await dataSource.query(
          `SELECT COALESCE(SUM(days), 0)::int AS sum FROM leave_records
           WHERE tenant_id = $1 AND staff_profile_id = $2 AND status = 'APPROVED'`,
          [TENANT_ID, staffProfileId],
        );
        return row.sum as number;
      }

      beforeEach(async () => {
        await setWeeklyOff([]); // every day is a working day unless the calendar says otherwise
      });

      it('under way: cut to end today; today stays counted, tomorrow onward comes back', async () => {
        const today = await schoolToday();
        const start = addDays(today, -2);
        const end = addDays(today, 2);
        const appId = await newApplication(TENANT_ID, staffProfileId, staffUserId);
        const created = await record(appId, start, end);

        const result = await cancel(appId);

        const row = await dataSource
          .getRepository(LeaveRecord)
          .findOneOrFail({ where: { id: created.leave_record_id } });
        // Still APPROVED: the days already taken stay used.
        expect(row.status).toBe(LeaveStatus.APPROVED);
        expect(row.end_date).toBe(today);
        expect(row.days).toBe(await service.countWorkingDays(TENANT_ID, start, today));
        expect(row.days).toBeGreaterThan(0);
        // Only dates after today come back; today keeps its LEAVE mark.
        expect(result.reverted_dates).toEqual(created.attendance_dates.filter((d) => d > today));
        expect(result.reverted_dates.length).toBeGreaterThan(0);
        expect(await approvedDays()).toBe(row.days);
      });

      it('fully ended (ends today): 409 LEAVE_ALREADY_ENDED, record and quota untouched', async () => {
        const today = await schoolToday();
        const start = addDays(today, -2);
        const appId = await newApplication(TENANT_ID, staffProfileId, staffUserId);
        const created = await record(appId, start, today);

        await expect(cancel(appId)).rejects.toMatchObject({
          status: 409,
          response: { details: { code: 'LEAVE_ALREADY_ENDED' } },
        });

        const row = await dataSource
          .getRepository(LeaveRecord)
          .findOneOrFail({ where: { id: created.leave_record_id } });
        // `days` is not recounted against today's calendar.
        expect(row.status).toBe(LeaveStatus.APPROVED);
        expect(row.end_date).toBe(today);
        expect(row.days).toBe(created.days);
        expect(await approvedDays()).toBe(created.days);
      });
    });

    it('does not touch another tenant row carrying the same application id', async () => {
      const schoolRepo = dataSource.getRepository(School);
      const otherSchool = await schoolRepo.save({
        name: 'Other Tenant School',
        slug: `other-tenant-${Date.now()}`,
      } as any);
      const otherUser = await dataSource
        .getRepository(User)
        .save({ email: `other-${Date.now()}@test.com`, full_name: 'Other' });
      const otherProfile = await dataSource.getRepository(StaffProfile).save({
        user_id: otherUser.id,
        tenant_id: otherSchool.id,
        employee_id: `EMP-OTHER-${Date.now()}`,
      });
      const otherApp = await newApplication(otherSchool.id, otherProfile.id, otherUser.id);
      const otherRow = await dataSource.getRepository(LeaveRecord).save({
        tenant_id: otherSchool.id,
        staff_profile_id: otherProfile.id,
        leave_type: LeaveType.CASUAL,
        start_date: THU,
        end_date: THU,
        days: 1,
        status: LeaveStatus.APPROVED,
        application_id: otherApp,
      });

      await expect(
        dataSource.transaction((manager) =>
          service.cancelApprovedLeave(manager, {
            tenantId: TENANT_ID,
            applicationId: otherApp,
            actorUserId: ADMIN_USER_ID,
            reason: null,
          }),
        ),
      ).rejects.toMatchObject({ response: { details: { code: 'LEAVE_NOT_CANCELLABLE' } } });

      const after = await dataSource
        .getRepository(LeaveRecord)
        .findOneOrFail({ where: { id: otherRow.id } });
      expect(after.status).toBe(LeaveStatus.APPROVED);
      await schoolRepo.delete({ id: otherSchool.id });
    });
  });
});

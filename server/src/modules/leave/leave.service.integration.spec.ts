import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import {
  ForbiddenException,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { DataSource } from 'typeorm';
import { getDataSourceToken } from '@nestjs/typeorm';
import { createTestModule } from '@test/helpers/module.helper';
import { ALL_ENTITIES } from '@test/all-entities';
import { SEED_TENANT_ID, SEED_ADMIN_USER_ID } from '@test/constants';
import { LeaveService } from './leave.service';
import { LeaveModule } from './leave.module';
import { AuthModule } from '../auth/auth.module';
import { School } from '../schools/entities/school.entity';
import { User } from '../users/entities/user.entity';
import { StaffProfile } from '../staff-profiles/entities/staff-profile.entity';
import { LeaveRecord } from './entities/leave-record.entity';
import { LeavePolicy } from './entities/leave-policy.entity';
import { AuditLog } from '../audit/entities/audit-log.entity';
import { AuditAction, LeaveStatus, LeaveType, UserRole } from '@biddaloy/shared';

/**
 * Integration tests for `LeaveService` against a real, migrated test
 * database — the balance formula, over-balance rejection, the year-boundary
 * balance rule, self-or-approver scoping, cross-tenant rejection, and the
 * concurrent-decide races (this is the money-tier reason for this file:
 * `decide()`'s transaction + pessimistic lock actually has to serialize two
 * real DB connections, which a mocked unit test cannot exercise). See
 * `staff-attendance.service.integration.spec.ts` for the pattern this
 * mirrors.
 */
describe('LeaveService (integration)', () => {
  let service: LeaveService;
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

  describe('request', () => {
    it('rejects a request that would exceed the remaining balance', async () => {
      await expect(
        service.request(
          TENANT_ID,
          {
            staff_profile_id: staffProfileId,
            leave_type: LeaveType.CASUAL,
            start_date: `${CURRENT_YEAR}-05-01`,
            end_date: `${CURRENT_YEAR}-05-15`, // 15 days > 10-day quota
          },
          staffUserId,
          UserRole.TEACHER,
        ),
      ).rejects.toThrow(UnprocessableEntityException);
    });

    it('creates a PENDING row when within balance', async () => {
      const result = await service.request(
        TENANT_ID,
        {
          staff_profile_id: staffProfileId,
          leave_type: LeaveType.CASUAL,
          start_date: `${CURRENT_YEAR}-05-01`,
          end_date: `${CURRENT_YEAR}-05-03`,
        },
        staffUserId,
        UserRole.TEACHER,
      );
      expect(result.status).toBe(LeaveStatus.PENDING);
      expect(result.days).toBe(3);
    });

    it('rejects with NotFoundException for a staff_profile_id belonging to another tenant', async () => {
      // A second, unrelated tenant + profile.
      const schoolRepo = dataSource.getRepository(School);
      const userRepo = dataSource.getRepository(User);
      const staffProfileRepo = dataSource.getRepository(StaffProfile);
      const otherSchool = await schoolRepo.save({
        name: 'Other Tenant School',
        slug: `other-tenant-${Date.now()}`,
      } as any);
      const otherUser = await userRepo.save({
        email: `other-tenant-${Date.now()}@test.com`,
        full_name: 'Other Tenant Staff',
      });
      const otherProfile = await staffProfileRepo.save({
        user_id: otherUser.id,
        tenant_id: otherSchool.id,
        employee_id: `EMP-OTHER-${Date.now()}`,
      });

      await expect(
        service.request(
          TENANT_ID,
          {
            staff_profile_id: otherProfile.id,
            leave_type: LeaveType.CASUAL,
            start_date: `${CURRENT_YEAR}-05-01`,
            end_date: `${CURRENT_YEAR}-05-02`,
          },
          staffUserId,
          UserRole.TEACHER,
        ),
      ).rejects.toThrow(NotFoundException);
    });

    it('rejects with ForbiddenException when a non-approver requests leave for a colleague', async () => {
      const userRepo = dataSource.getRepository(User);
      const otherUser = await userRepo.save({
        email: `colleague-${Date.now()}@test.com`,
        full_name: 'Colleague',
      });

      await expect(
        service.request(
          TENANT_ID,
          {
            staff_profile_id: staffProfileId,
            leave_type: LeaveType.CASUAL,
            start_date: `${CURRENT_YEAR}-05-01`,
            end_date: `${CURRENT_YEAR}-05-02`,
          },
          otherUser.id, // not staffProfileId's own user
          UserRole.TEACHER,
        ),
      ).rejects.toThrow(ForbiddenException);
    });

    it('a leave spanning a year boundary is checked against the year of its own start_date, not the current year', async () => {
      const recordRepo = dataSource.getRepository(LeaveRecord);
      // Seed the CASUAL quota for next year too, and 8 already-approved days
      // *in* next year — a request that only looked at the current year's
      // usage (0) would wrongly allow this.
      await dataSource.query(
        `INSERT INTO leave_policies (id, tenant_id, leave_type, annual_quota_days, created_at, updated_at)
         VALUES (gen_random_uuid(), $1, 'CASUAL', 10, NOW(), NOW())
         ON CONFLICT (tenant_id, leave_type) DO UPDATE SET annual_quota_days = 10`,
        [TENANT_ID],
      );
      await recordRepo.save({
        tenant_id: TENANT_ID,
        staff_profile_id: staffProfileId,
        leave_type: LeaveType.CASUAL,
        start_date: `${NEXT_YEAR}-01-01`,
        end_date: `${NEXT_YEAR}-01-08`,
        days: 8,
        status: LeaveStatus.APPROVED,
      });

      await expect(
        service.request(
          TENANT_ID,
          {
            staff_profile_id: staffProfileId,
            leave_type: LeaveType.CASUAL,
            start_date: `${NEXT_YEAR}-01-09`,
            end_date: `${NEXT_YEAR}-01-11`, // 3 more days, 8 + 3 = 11 > 10
          },
          staffUserId,
          UserRole.TEACHER,
        ),
      ).rejects.toThrow(UnprocessableEntityException);
    });
  });

  describe('decide', () => {
    it('approving writes an audit row with old/new status', async () => {
      const record = await service.request(
        TENANT_ID,
        {
          staff_profile_id: staffProfileId,
          leave_type: LeaveType.CASUAL,
          start_date: `${CURRENT_YEAR}-06-01`,
          end_date: `${CURRENT_YEAR}-06-02`,
        },
        staffUserId,
        UserRole.TEACHER,
      );

      await service.decide(
        TENANT_ID,
        record.id,
        ADMIN_USER_ID,
        { approve: true },
        {
          ip: '127.0.0.1',
          userAgent: 'vitest',
        },
      );

      const auditRepo = dataSource.getRepository(AuditLog);
      const audits = await auditRepo.find({
        where: { tenant_id: TENANT_ID, entity_type: 'LeaveRecord', action: AuditAction.UPDATE },
      });
      expect(audits.length).toBeGreaterThan(0);
      const audit = audits.find((a) => a.entity_id === record.id);
      expect(audit).toBeDefined();
      expect(audit!.old_values).toEqual({ status: LeaveStatus.PENDING });
      expect((audit!.new_values as any).status).toBe(LeaveStatus.APPROVED);
    });

    it('rejecting does not re-check balance and writes an audit row', async () => {
      const record = await service.request(
        TENANT_ID,
        {
          staff_profile_id: staffProfileId,
          leave_type: LeaveType.CASUAL,
          start_date: `${CURRENT_YEAR}-06-10`,
          end_date: `${CURRENT_YEAR}-06-11`,
        },
        staffUserId,
        UserRole.TEACHER,
      );

      const result = await service.decide(
        TENANT_ID,
        record.id,
        ADMIN_USER_ID,
        { approve: false },
        {
          ip: null,
          userAgent: null,
        },
      );

      expect(result.status).toBe(LeaveStatus.REJECTED);
      const balance = await service.getBalance(TENANT_ID, staffProfileId, LeaveType.CASUAL);
      expect(balance.balance).toBe(10); // rejected leave never reduced it

      const auditRepo = dataSource.getRepository(AuditLog);
      const audit = await auditRepo.findOne({
        where: { tenant_id: TENANT_ID, entity_type: 'LeaveRecord', entity_id: record.id },
      });
      expect(audit).toBeDefined();
      expect(audit!.old_values).toEqual({ status: LeaveStatus.PENDING });
      expect((audit!.new_values as any).status).toBe(LeaveStatus.REJECTED);
    });

    it('rejects with NotFoundException for a leave record belonging to another tenant', async () => {
      const schoolRepo = dataSource.getRepository(School);
      const otherSchool = await schoolRepo.save({
        name: 'Other Tenant School 2',
        slug: `other-tenant-2-${Date.now()}`,
      } as any);
      const userRepo = dataSource.getRepository(User);
      const staffProfileRepo = dataSource.getRepository(StaffProfile);
      const otherUser = await userRepo.save({
        email: `other-tenant-2-${Date.now()}@test.com`,
        full_name: 'Other Tenant Staff 2',
      });
      const otherProfile = await staffProfileRepo.save({
        user_id: otherUser.id,
        tenant_id: otherSchool.id,
        employee_id: `EMP-OTHER-2-${Date.now()}`,
      });
      const recordRepo = dataSource.getRepository(LeaveRecord);
      const otherRecord = await recordRepo.save({
        tenant_id: otherSchool.id,
        staff_profile_id: otherProfile.id,
        leave_type: LeaveType.CASUAL,
        start_date: `${CURRENT_YEAR}-06-01`,
        end_date: `${CURRENT_YEAR}-06-02`,
        days: 2,
        status: LeaveStatus.PENDING,
      });

      await expect(
        // Deciding on TENANT_ID for a record that actually belongs to
        // otherSchool.id must 404, not leak or act cross-tenant.
        service.decide(
          TENANT_ID,
          otherRecord.id,
          ADMIN_USER_ID,
          { approve: true },
          {
            ip: null,
            userAgent: null,
          },
        ),
      ).rejects.toThrow(NotFoundException);
    });

    it('two concurrent approvals that would jointly exceed the quota: the second one fails', async () => {
      // Two 6-day requests against a 10-day quota — either alone fits,
      // approving both must not (6 + 6 = 12 > 10). This is the scenario the
      // transaction + pessimistic row lock in `decide()`'s approve path
      // exists for: without it, both reads would see balance=10 and both
      // would pass the check.
      const first = await service.request(
        TENANT_ID,
        {
          staff_profile_id: staffProfileId,
          leave_type: LeaveType.CASUAL,
          start_date: `${CURRENT_YEAR}-07-01`,
          end_date: `${CURRENT_YEAR}-07-06`,
        },
        staffUserId,
        UserRole.TEACHER,
      );
      const second = await service.request(
        TENANT_ID,
        {
          staff_profile_id: staffProfileId,
          leave_type: LeaveType.CASUAL,
          start_date: `${CURRENT_YEAR}-07-10`,
          end_date: `${CURRENT_YEAR}-07-15`,
        },
        staffUserId,
        UserRole.TEACHER,
      );

      const decideCtx = { ip: null, userAgent: null };
      const results = await Promise.allSettled([
        service.decide(TENANT_ID, first.id, ADMIN_USER_ID, { approve: true }, decideCtx),
        service.decide(TENANT_ID, second.id, ADMIN_USER_ID, { approve: true }, decideCtx),
      ]);

      const fulfilled = results.filter((r) => r.status === 'fulfilled');
      const rejected = results.filter((r) => r.status === 'rejected');
      expect(fulfilled).toHaveLength(1);
      expect(rejected).toHaveLength(1);

      const balance = await service.getBalance(TENANT_ID, staffProfileId, LeaveType.CASUAL);
      expect(balance.balance).toBe(4); // only one 6-day approval ever landed
    });

    it('same-record double-approve race: exactly one approval wins, the other sees it is no longer PENDING', async () => {
      const record = await service.request(
        TENANT_ID,
        {
          staff_profile_id: staffProfileId,
          leave_type: LeaveType.CASUAL,
          start_date: `${CURRENT_YEAR}-08-01`,
          end_date: `${CURRENT_YEAR}-08-02`,
        },
        staffUserId,
        UserRole.TEACHER,
      );

      const decideCtx = { ip: null, userAgent: null };
      const results = await Promise.allSettled([
        service.decide(TENANT_ID, record.id, ADMIN_USER_ID, { approve: true }, decideCtx),
        service.decide(TENANT_ID, record.id, ADMIN_USER_ID, { approve: true }, decideCtx),
      ]);

      const fulfilled = results.filter((r) => r.status === 'fulfilled');
      const rejected = results.filter((r) => r.status === 'rejected');
      expect(fulfilled).toHaveLength(1);
      expect(rejected).toHaveLength(1);
    });

    it('reject-vs-approve race on the same record: exactly one decision wins', async () => {
      const record = await service.request(
        TENANT_ID,
        {
          staff_profile_id: staffProfileId,
          leave_type: LeaveType.CASUAL,
          start_date: `${CURRENT_YEAR}-08-10`,
          end_date: `${CURRENT_YEAR}-08-11`,
        },
        staffUserId,
        UserRole.TEACHER,
      );

      const decideCtx = { ip: null, userAgent: null };
      const results = await Promise.allSettled([
        service.decide(TENANT_ID, record.id, ADMIN_USER_ID, { approve: true }, decideCtx),
        service.decide(TENANT_ID, record.id, ADMIN_USER_ID, { approve: false }, decideCtx),
      ]);

      const fulfilled = results.filter((r) => r.status === 'fulfilled');
      const rejected = results.filter((r) => r.status === 'rejected');
      expect(fulfilled).toHaveLength(1);
      expect(rejected).toHaveLength(1);

      const finalRecord = await dataSource
        .getRepository(LeaveRecord)
        .findOne({ where: { id: record.id } });
      expect([LeaveStatus.APPROVED, LeaveStatus.REJECTED]).toContain(finalRecord!.status);
    });
  });
});

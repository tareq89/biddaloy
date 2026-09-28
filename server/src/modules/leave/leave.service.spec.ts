import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  ForbiddenException,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { LeaveStatus, LeaveType, UserRole } from '@biddaloy/shared';
import { LeaveService } from './leave.service';

/**
 * Unit tests for `LeaveService` with mocked repositories/DataSource — the
 * balance formula, request-rejection rules, and the self-or-approver
 * scoping, no real DB. See `leave.service.integration.spec.ts` for the
 * DB-backed lock/race tests.
 */
describe('LeaveService (unit)', () => {
  const TENANT_ID = 'tenant-1';
  const STAFF_PROFILE_ID = 'staff-1';
  const OWNER_USER_ID = 'user-owner';
  const OTHER_USER_ID = 'user-other';

  let leaveRecordRepo: any;
  let leavePolicyRepo: any;
  let staffProfileRepo: any;
  let auditService: any;
  let dataSource: any;
  let service: LeaveService;

  function makeQueryBuilder(sum: number) {
    return {
      select: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      andWhere: vi.fn().mockReturnThis(),
      getRawOne: vi.fn().mockResolvedValue({ sum: String(sum) }),
    };
  }

  beforeEach(() => {
    leaveRecordRepo = {
      createQueryBuilder: vi.fn(),
      find: vi.fn(),
      findOne: vi.fn(),
      save: vi.fn((x: unknown) => Promise.resolve(x)),
      create: vi.fn((x: unknown) => x),
    };
    leavePolicyRepo = {
      findOne: vi.fn(),
      find: vi.fn(),
      save: vi.fn((x: unknown) => Promise.resolve(x)),
    };
    staffProfileRepo = {
      findOne: vi.fn().mockResolvedValue({
        id: STAFF_PROFILE_ID,
        tenant_id: TENANT_ID,
        user_id: OWNER_USER_ID,
      }),
    };
    auditService = { record: vi.fn().mockResolvedValue(undefined) };
    dataSource = { transaction: vi.fn() };

    service = new LeaveService(
      dataSource,
      leaveRecordRepo,
      leavePolicyRepo,
      staffProfileRepo,
      auditService,
    );
  });

  const CURRENT_YEAR = new Date().getUTCFullYear();

  describe('getBalance', () => {
    it('is quota minus approved days this year: 10-day CASUAL quota, 3 approved days -> balance 7', async () => {
      leavePolicyRepo.findOne.mockResolvedValue({ annual_quota_days: 10 });
      leaveRecordRepo.createQueryBuilder.mockReturnValue(makeQueryBuilder(3));

      const balance = await service.getBalance(TENANT_ID, STAFF_PROFILE_ID, LeaveType.CASUAL);

      expect(balance.annual_quota_days).toBe(10);
      expect(balance.used_days).toBe(3);
      expect(balance.balance).toBe(7);
    });

    it('the SQL query only ever sums APPROVED rows — pending/rejected are excluded at the query, not by app-side filtering', async () => {
      leavePolicyRepo.findOne.mockResolvedValue({ annual_quota_days: 10 });
      const qb = makeQueryBuilder(0);
      leaveRecordRepo.createQueryBuilder.mockReturnValue(qb);

      await service.getBalance(TENANT_ID, STAFF_PROFILE_ID, LeaveType.CASUAL);

      expect(qb.andWhere).toHaveBeenCalledWith(
        'leave_record.status = :status',
        expect.objectContaining({ status: LeaveStatus.APPROVED }),
      );
    });
  });

  describe('request', () => {
    it('rejects a request that would exceed the remaining balance', async () => {
      leavePolicyRepo.findOne.mockResolvedValue({ annual_quota_days: 10 });
      leaveRecordRepo.createQueryBuilder.mockReturnValue(makeQueryBuilder(8)); // balance = 2

      await expect(
        service.request(
          TENANT_ID,
          {
            staff_profile_id: STAFF_PROFILE_ID,
            leave_type: LeaveType.CASUAL,
            start_date: `${CURRENT_YEAR}-01-01`,
            end_date: `${CURRENT_YEAR}-01-05`, // 5 days > 2 remaining
          },
          OWNER_USER_ID,
          UserRole.TEACHER,
        ),
      ).rejects.toThrow(UnprocessableEntityException);

      expect(leaveRecordRepo.save).not.toHaveBeenCalled();
    });

    it('creates a PENDING row when within balance', async () => {
      leavePolicyRepo.findOne.mockResolvedValue({ annual_quota_days: 10 });
      leaveRecordRepo.createQueryBuilder.mockReturnValue(makeQueryBuilder(3)); // balance = 7

      const result = await service.request(
        TENANT_ID,
        {
          staff_profile_id: STAFF_PROFILE_ID,
          leave_type: LeaveType.CASUAL,
          start_date: `${CURRENT_YEAR}-01-01`,
          end_date: `${CURRENT_YEAR}-01-02`, // 2 inclusive days
        },
        OWNER_USER_ID,
        UserRole.TEACHER,
      );

      expect(result.status).toBe(LeaveStatus.PENDING);
      expect(result.days).toBe(2);
    });

    it('checks the balance against the year of start_date, not the current calendar year', async () => {
      leavePolicyRepo.findOne.mockResolvedValue({ annual_quota_days: 10 });
      const qb = makeQueryBuilder(0);
      leaveRecordRepo.createQueryBuilder.mockReturnValue(qb);

      await service.request(
        TENANT_ID,
        {
          staff_profile_id: STAFF_PROFILE_ID,
          leave_type: LeaveType.CASUAL,
          start_date: `${CURRENT_YEAR + 1}-01-01`,
          end_date: `${CURRENT_YEAR + 1}-01-02`,
        },
        OWNER_USER_ID,
        UserRole.TEACHER,
      );

      expect(qb.andWhere).toHaveBeenCalledWith('leave_record.start_date BETWEEN :from AND :to', {
        from: `${CURRENT_YEAR + 1}-01-01`,
        to: `${CURRENT_YEAR + 1}-12-31`,
      });
    });

    it('rejects with NotFoundException when the staff profile is not in this tenant', async () => {
      staffProfileRepo.findOne.mockResolvedValue(null);

      await expect(
        service.request(
          TENANT_ID,
          {
            staff_profile_id: 'foreign-profile',
            leave_type: LeaveType.CASUAL,
            start_date: `${CURRENT_YEAR}-01-01`,
            end_date: `${CURRENT_YEAR}-01-02`,
          },
          OWNER_USER_ID,
          UserRole.TEACHER,
        ),
      ).rejects.toThrow(NotFoundException);
    });

    it('rejects with ForbiddenException when a non-approver requests leave for someone else', async () => {
      await expect(
        service.request(
          TENANT_ID,
          {
            staff_profile_id: STAFF_PROFILE_ID,
            leave_type: LeaveType.CASUAL,
            start_date: `${CURRENT_YEAR}-01-01`,
            end_date: `${CURRENT_YEAR}-01-02`,
          },
          OTHER_USER_ID,
          UserRole.TEACHER,
        ),
      ).rejects.toThrow(ForbiddenException);
    });

    it('allows an ADMIN (holds LEAVE_APPROVE) to request leave on behalf of another staff profile', async () => {
      leavePolicyRepo.findOne.mockResolvedValue({ annual_quota_days: 10 });
      leaveRecordRepo.createQueryBuilder.mockReturnValue(makeQueryBuilder(0));

      const result = await service.request(
        TENANT_ID,
        {
          staff_profile_id: STAFF_PROFILE_ID,
          leave_type: LeaveType.CASUAL,
          start_date: `${CURRENT_YEAR}-01-01`,
          end_date: `${CURRENT_YEAR}-01-02`,
        },
        OTHER_USER_ID,
        UserRole.ADMIN,
      );

      expect(result.status).toBe(LeaveStatus.PENDING);
    });
  });

  describe('decide — reject', () => {
    function mockRejectTransaction(record: any) {
      const recordRepo = {
        findOne: vi.fn().mockResolvedValue(record),
        save: vi.fn((x: unknown) => Promise.resolve(x)),
      };
      dataSource.transaction.mockImplementation(async (cb: any) =>
        cb({ getRepository: () => recordRepo }),
      );
      return recordRepo;
    }

    it('rejecting needs no balance re-check and writes an audit row with old/new status', async () => {
      const record = {
        id: 'rec-1',
        status: LeaveStatus.PENDING,
        staff_profile_id: STAFF_PROFILE_ID,
        leave_type: LeaveType.CASUAL,
        days: 2,
      };
      mockRejectTransaction(record);

      const result = await service.decide(
        TENANT_ID,
        'rec-1',
        'admin-1',
        { approve: false },
        {
          ip: null,
          userAgent: null,
        },
      );

      expect(result.status).toBe(LeaveStatus.REJECTED);
      expect(auditService.record).toHaveBeenCalledWith(
        expect.objectContaining({
          entity_type: 'LeaveRecord',
          old_values: { status: LeaveStatus.PENDING },
          new_values: expect.objectContaining({ status: LeaveStatus.REJECTED }),
        }),
        expect.anything(),
      );
    });

    it('rejects with UnprocessableEntityException when the record is not PENDING (lost the reject-vs-approve race)', async () => {
      const record = {
        id: 'rec-1',
        status: LeaveStatus.APPROVED,
        staff_profile_id: STAFF_PROFILE_ID,
        leave_type: LeaveType.CASUAL,
        days: 2,
      };
      mockRejectTransaction(record);

      await expect(
        service.decide(
          TENANT_ID,
          'rec-1',
          'admin-1',
          { approve: false },
          {
            ip: null,
            userAgent: null,
          },
        ),
      ).rejects.toThrow(UnprocessableEntityException);
    });

    it('rejects with NotFoundException when the record does not exist in this tenant', async () => {
      mockRejectTransaction(null);

      await expect(
        service.decide(
          TENANT_ID,
          'rec-missing',
          'admin-1',
          { approve: false },
          {
            ip: null,
            userAgent: null,
          },
        ),
      ).rejects.toThrow(NotFoundException);
    });
  });
});

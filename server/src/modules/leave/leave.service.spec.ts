import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { LeaveStatus, LeaveType, UserRole } from '@biddaloy/shared';
import { localToday } from '../../common/time';
import { LeaveService } from './leave.service';

/**
 * Unit tests for `LeaveService` with mocked repositories — the
 * balance formula and the null-quota rule, no real DB. See `leave.service.integration.spec.ts` for the
 * DB-backed lock/race tests.
 */
describe('LeaveService (unit)', () => {
  const TENANT_ID = 'tenant-1';
  const STAFF_PROFILE_ID = 'staff-1';
  const OWNER_USER_ID = 'user-owner';

  let leaveRecordRepo: any;
  let leavePolicyRepo: any;
  let staffProfileRepo: any;
  let auditService: any;
  let service: LeaveService;

  let calendar: any;

  /** One APPROVED record whose live working-day count (mocked calendar) is `days`. */
  function makeQueryBuilder(days: number) {
    calendar.getWorkingDays.mockResolvedValue({ count: days });
    return {
      where: vi.fn().mockReturnThis(),
      andWhere: vi.fn().mockReturnThis(),
      getMany: vi
        .fn()
        .mockResolvedValue(days > 0 ? [{ start_date: '2026-02-01', end_date: '2026-02-03' }] : []),
    };
  }

  let schoolsService: { todayFor: ReturnType<typeof vi.fn> };
  let tenantTz: string;

  afterEach(() => {
    vi.useRealTimers();
  });

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
    calendar = { getWorkingDays: vi.fn() };
    tenantTz = 'Asia/Dhaka';
    // Same derivation as the real `SchoolsService.todayFor`, minus the DB read.
    schoolsService = { todayFor: vi.fn(async () => localToday(tenantTz)) };

    service = new LeaveService(
      leaveRecordRepo,
      leavePolicyRepo,
      staffProfileRepo,
      auditService,
      calendar,
      { markLeaveRange: vi.fn(), revertLeaveRange: vi.fn() } as any,
      schoolsService,
    );
  });

  describe('null quota (unlimited, D19)', () => {
    it('getBalance returns quota null and balance null', async () => {
      leavePolicyRepo.findOne.mockResolvedValue({ annual_quota_days: null });
      leaveRecordRepo.createQueryBuilder.mockReturnValue(makeQueryBuilder(4));

      const balance = await service.getBalance(TENANT_ID, STAFF_PROFILE_ID, LeaveType.EARNED);

      expect(balance.annual_quota_days).toBeNull();
      expect(balance.balance).toBeNull();
      expect(balance.used_days).toBe(4);
    });

    it('updatePolicy stores and returns null', async () => {
      const policy = { leave_type: LeaveType.EARNED, annual_quota_days: 5 };
      leavePolicyRepo.findOne.mockResolvedValue(policy);

      const result = await service.updatePolicy(TENANT_ID, LeaveType.EARNED, null);

      expect(result).toEqual({ leave_type: LeaveType.EARNED, annual_quota_days: null });
    });
  });

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

  describe('getBalance year is the tenant-local year', () => {
    it.each([
      ['2026-12-31T17:59:00Z', 'Asia/Dhaka', '2026'],
      ['2026-12-31T18:00:00Z', 'Asia/Dhaka', '2027'],
      ['2026-12-31T23:59:00Z', 'Asia/Dhaka', '2027'],
      ['2027-01-01T00:00:00Z', 'Asia/Dhaka', '2027'],
      ['2027-01-01T01:00:00Z', 'America/New_York', '2026'],
      ['2027-01-01T05:00:00Z', 'America/New_York', '2027'],
    ])('at %s in %s the range is %s', async (instant, tz, year) => {
      vi.useFakeTimers({ toFake: ['Date'] });
      vi.setSystemTime(new Date(instant));
      tenantTz = tz;
      leavePolicyRepo.findOne.mockResolvedValue({ annual_quota_days: 10 });
      const qb = makeQueryBuilder(0);
      leaveRecordRepo.createQueryBuilder.mockReturnValue(qb);

      await service.getBalance(TENANT_ID, STAFF_PROFILE_ID, LeaveType.CASUAL);

      expect(qb.andWhere).toHaveBeenCalledWith(
        expect.stringContaining('start_date'),
        expect.objectContaining({ from: `${year}-01-01`, to: `${year}-12-31` }),
      );
    });

    it('getBalancesForCaller resolves the tenant day once, not once per leave type', async () => {
      leavePolicyRepo.findOne.mockResolvedValue({ annual_quota_days: 10 });
      leaveRecordRepo.createQueryBuilder.mockReturnValue(makeQueryBuilder(0));

      await service.getBalancesForCaller(TENANT_ID, STAFF_PROFILE_ID, OWNER_USER_ID, UserRole.TEACHER);

      expect(schoolsService.todayFor).toHaveBeenCalledTimes(1);
    });
  });
});

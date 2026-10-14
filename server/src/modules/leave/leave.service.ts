import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, Repository } from 'typeorm';
import {
  AuditAction,
  LeaveStatus,
  LeaveType,
  Permission,
  UserRole,
  roleHasPermission,
} from '@biddaloy/shared';
import { LeaveRecord } from './entities/leave-record.entity';
import { LeavePolicy } from './entities/leave-policy.entity';
import { StaffProfile } from '../staff-profiles/entities/staff-profile.entity';
import { AuditService } from '../audit/audit.service';
import { SchoolCalendarService } from '../calendar/school-calendar.service';
import { SchoolsService } from '../schools/schools.service';
import { StaffAttendanceService } from '../staff-attendance/staff-attendance.service';
import { LeaveBalanceDto, LeavePolicyDto } from './dto/leave.dto';

/** Jan 1 - Dec 31 of `year` (D16: leave year = calendar year). */
function yearRange(year: number): { from: string; to: string } {
  return { from: `${year}-01-01`, to: `${year}-12-31` };
}

/**
 * [36.3] Staff leave balance + policies, and the approved-leave ledger writes
 * the applications module calls. Balance is always computed live —
 * `quota - sum(APPROVED days in the relevant year)`. Requests and decisions
 * go through applications (D20).
 */
@Injectable()
export class LeaveService {
  constructor(
    @InjectRepository(LeaveRecord)
    private readonly leaveRecordRepo: Repository<LeaveRecord>,
    @InjectRepository(LeavePolicy)
    private readonly leavePolicyRepo: Repository<LeavePolicy>,
    @InjectRepository(StaffProfile)
    private readonly staffProfileRepo: Repository<StaffProfile>,
    private readonly auditService: AuditService,
    private readonly schoolCalendarService: SchoolCalendarService,
    private readonly staffAttendanceService: StaffAttendanceService,
    private readonly schoolsService: SchoolsService,
  ) {}

  private async getPolicy(tenantId: string, leaveType: LeaveType): Promise<LeavePolicy> {
    const policy = await this.leavePolicyRepo.findOne({
      where: { tenant_id: tenantId, leave_type: leaveType },
    });
    if (!policy) {
      throw new NotFoundException(`No leave policy for ${leaveType} in this tenant`);
    }
    return policy;
  }

  /**
   * A staff profile must belong to this tenant (no cross-tenant read/write),
   * and unless the caller holds `LEAVE_APPROVE` (an approver acting on
   * anyone's leave), the profile must be the caller's own — the
   * `staff_profile_id` on these routes comes from the request body/query,
   * not the JWT, so without this check any staff role could file leave for
   * or read the balance of a colleague.
   */
  private async assertStaffProfileAccessible(
    tenantId: string,
    staffProfileId: string,
    callerUserId: string,
    role: UserRole,
  ): Promise<StaffProfile> {
    const profile = await this.staffProfileRepo.findOne({
      where: { id: staffProfileId, tenant_id: tenantId },
    });
    if (!profile) {
      throw new NotFoundException('Staff profile not found');
    }
    if (!roleHasPermission(role, Permission.LEAVE_APPROVE) && profile.user_id !== callerUserId) {
      throw new ForbiddenException('You may only act on your own leave records');
    }
    return profile;
  }

  /** The tenant-local calendar year (its `region.timezone`), not the UTC one. */
  private async currentYearRange(tenantId: string): Promise<{ from: string; to: string }> {
    const year = (await this.schoolsService.todayFor(tenantId)).slice(0, 4);
    return yearRange(Number(year));
  }

  /** `quota - sum(APPROVED days this calendar year in the tenant's timezone)`, computed live — no
   * stored counter (D12). Read-only display endpoint: intentionally always
   * the *current* year, unlike the request/decide balance checks which use
   * every calendar year the leave touches. */
  async getBalance(
    tenantId: string,
    staffProfileId: string,
    leaveType: LeaveType,
    range?: { from: string; to: string },
  ): Promise<LeaveBalanceDto> {
    return this.computeBalance(
      this.leaveRecordRepo,
      tenantId,
      staffProfileId,
      leaveType,
      range ?? (await this.currentYearRange(tenantId)),
    );
  }

  /** Self-or-approver-scoped balance read for the controller — every
   * `LeaveType` for one staff profile. */
  async getBalancesForCaller(
    tenantId: string,
    staffProfileId: string,
    callerUserId: string,
    role: UserRole,
  ): Promise<LeaveBalanceDto[]> {
    await this.assertStaffProfileAccessible(tenantId, staffProfileId, callerUserId, role);
    const types = Object.values(LeaveType);
    const range = await this.currentYearRange(tenantId);
    return Promise.all(
      types.map((leaveType) => this.getBalance(tenantId, staffProfileId, leaveType, range)),
    );
  }

  private async computeBalance(
    repo: Repository<LeaveRecord>,
    tenantId: string,
    staffProfileId: string,
    leaveType: LeaveType,
    range: { from: string; to: string },
  ): Promise<LeaveBalanceDto> {
    const policy = await this.getPolicy(tenantId, leaveType);
    const usedDays = await this.approvedDaysInRange(
      repo,
      tenantId,
      staffProfileId,
      leaveType,
      range,
    );
    return {
      leave_type: leaveType,
      annual_quota_days: policy.annual_quota_days,
      used_days: usedDays,
      // null quota = unlimited (D19): no balance, never coerced to 0
      balance: policy.annual_quota_days === null ? null : policy.annual_quota_days - usedDays,
    };
  }

  /**
   * Working days of APPROVED leaves that fall inside `range`, counted live from
   * today's calendar [TIME-13]: a leave crossing a boundary is split, and a
   * holiday declared later stops costing a day.
   */
  private async approvedDaysInRange(
    repo: Repository<LeaveRecord>,
    tenantId: string,
    staffProfileId: string,
    leaveType: LeaveType,
    range: { from: string; to: string },
  ): Promise<number> {
    const { from, to } = range;
    const records = await repo
      .createQueryBuilder('leave_record')
      .where('leave_record.tenant_id = :tenantId', { tenantId })
      .andWhere('leave_record.staff_profile_id = :staffProfileId', { staffProfileId })
      .andWhere('leave_record.leave_type = :leaveType', { leaveType })
      .andWhere('leave_record.status = :status', { status: LeaveStatus.APPROVED })
      .andWhere('leave_record.start_date <= :to AND leave_record.end_date >= :from', { from, to })
      .getMany();
    const counts = await Promise.all(
      records.map((r) =>
        this.countWorkingDays(
          tenantId,
          r.start_date > from ? r.start_date : from,
          r.end_date < to ? r.end_date : to,
        ),
      ),
    );
    return counts.reduce((a, b) => a + b, 0);
  }

  async listPolicies(tenantId: string): Promise<LeavePolicyDto[]> {
    const policies = await this.leavePolicyRepo.find({ where: { tenant_id: tenantId } });
    return policies.map((p) => ({
      leave_type: p.leave_type,
      annual_quota_days: p.annual_quota_days,
    }));
  }

  async updatePolicy(
    tenantId: string,
    leaveType: LeaveType,
    annualQuotaDays: number | null,
  ): Promise<LeavePolicyDto> {
    const policy = await this.getPolicy(tenantId, leaveType);
    policy.annual_quota_days = annualQuotaDays;
    const saved = await this.leavePolicyRepo.save(policy);
    return { leave_type: saved.leave_type, annual_quota_days: saved.annual_quota_days };
  }

  /** Tenant-wide working days in `[from, to]` (staff have no class; no half days, D19). */
  async countWorkingDays(tenantId: string, from: string, to: string): Promise<number> {
    return (await this.schoolCalendarService.getWorkingDays({ tenantId, from, to })).count;
  }

  /**
   * Writes an APPROVED leave record and stamps LEAVE on the staff register.
   * Runs only on the caller's `manager` (never opens a transaction); locks the
   * staff member's records of this type so concurrent approvals serialize.
   */
  async recordApprovedLeave(
    manager: EntityManager,
    params: {
      tenantId: string;
      staffProfileId: string;
      leaveType: LeaveType;
      startDate: string;
      endDate: string;
      reason: string | null;
      applicationId: string;
      approvedByUserId: string;
    },
  ): Promise<{ leave_record_id: string; days: number; attendance_dates: string[] }> {
    const { tenantId, staffProfileId, leaveType, startDate, endDate } = params;
    const recordRepo = manager.getRepository(LeaveRecord);

    // Locking only the leave rows would not serialize two first-ever approvals
    // (no rows to lock), so also lock the staff profile row, which always exists.
    const profile = await manager.getRepository(StaffProfile).findOne({
      where: { id: staffProfileId, tenant_id: tenantId },
      lock: { mode: 'for_no_key_update' },
    });
    if (!profile) {
      throw new NotFoundException('Staff profile not found');
    }
    await recordRepo
      .createQueryBuilder('leave_record')
      .setLock('pessimistic_write')
      .where('leave_record.tenant_id = :tenantId', { tenantId })
      .andWhere('leave_record.staff_profile_id = :staffProfileId', { staffProfileId })
      .andWhere('leave_record.leave_type = :leaveType', { leaveType })
      .orderBy('leave_record.id')
      .getMany();

    const days = await this.countWorkingDays(tenantId, startDate, endDate);
    if (days === 0) {
      throw new UnprocessableEntityException({
        message: 'The selected dates contain no working days',
        details: { code: 'LEAVE_NO_WORKING_DAYS' },
      });
    }

    const policy = await manager
      .getRepository(LeavePolicy)
      .findOne({ where: { tenant_id: tenantId, leave_type: leaveType } });
    if (!policy) {
      // 422, not 404: on `POST /applications/:id/approve` a 404 reads as "no such application".
      throw new UnprocessableEntityException({
        message: `No leave policy for ${leaveType} in this tenant`,
        details: { code: 'LEAVE_POLICY_MISSING' },
      });
    }
    if (policy.annual_quota_days !== null) {
      // Each calendar year the leave touches is checked against its own balance [TIME-13].
      for (let year = Number(startDate.slice(0, 4)); year <= Number(endDate.slice(0, 4)); year++) {
        const { from, to } = yearRange(year);
        const requested = await this.countWorkingDays(
          tenantId,
          startDate > from ? startDate : from,
          endDate < to ? endDate : to,
        );
        // A year the leave takes no working day from cannot be over-drawn by it.
        if (requested === 0) continue;
        const used = await this.approvedDaysInRange(
          recordRepo,
          tenantId,
          staffProfileId,
          leaveType,
          {
            from,
            to,
          },
        );
        const balance = policy.annual_quota_days - used;
        if (requested > balance) {
          throw new UnprocessableEntityException({
            message: `Approving would exceed the remaining balance of ${balance} for ${year}`,
            details: { code: 'LEAVE_BALANCE_EXCEEDED' },
          });
        }
      }
    }

    const saved = await recordRepo.save(
      recordRepo.create({
        tenant_id: tenantId,
        staff_profile_id: staffProfileId,
        leave_type: leaveType,
        start_date: startDate,
        end_date: endDate,
        days,
        status: LeaveStatus.APPROVED,
        reason: params.reason,
        application_id: params.applicationId,
        approved_by: params.approvedByUserId,
        decided_at: new Date(),
      }),
    );
    await this.auditService.record(
      {
        action: AuditAction.CREATE,
        entity_type: 'LeaveRecord',
        entity_id: saved.id,
        tenant_id: tenantId,
        performed_by_user_id: params.approvedByUserId,
        old_values: null,
        new_values: {
          status: LeaveStatus.APPROVED,
          days,
          leave_type: leaveType,
          application_id: params.applicationId,
        },
      },
      manager,
    );

    const { dates } = await this.staffAttendanceService.markLeaveRange(manager, {
      tenantId,
      staffProfileId,
      from: startDate,
      to: endDate,
      actorUserId: params.approvedByUserId,
      applicationId: params.applicationId,
    });
    return { leave_record_id: saved.id, days, attendance_dates: dates };
  }

  /**
   * Cancels the APPROVED record created for an application. The balance sums
   * only APPROVED rows, so the days come back by themselves (D31). By default
   * only days after today come back, matching the register: a leave already
   * under way is cut to end today and stays APPROVED for the days taken; a
   * leave that has already ended is refused (409 LEAVE_ALREADY_ENDED). With
   * `revokeTakenDays` (approved by mistake) the whole record is CANCELLED,
   * every day comes back and past LEAVE marks are deleted too, ended or not.
   * Runs only on the caller's `manager`.
   */
  async cancelApprovedLeave(
    manager: EntityManager,
    params: {
      tenantId: string;
      applicationId: string;
      actorUserId: string;
      reason: string | null;
      /** Leave approved by mistake: CANCEL the whole record and delete past marks too. */
      revokeTakenDays?: boolean;
    },
  ): Promise<{ leave_record_id: string; reverted_dates: string[] }> {
    const { tenantId, applicationId, actorUserId, reason, revokeTakenDays } = params;
    const recordRepo = manager.getRepository(LeaveRecord);
    const record = await recordRepo.findOne({
      where: { tenant_id: tenantId, application_id: applicationId, status: LeaveStatus.APPROVED },
      lock: { mode: 'pessimistic_write' },
    });
    if (!record) {
      throw new UnprocessableEntityException({
        message: 'This leave cannot be cancelled',
        details: { code: 'LEAVE_NOT_CANCELLABLE' },
      });
    }

    const { dates, today } = await this.staffAttendanceService.revertLeaveRange(manager, {
      tenantId,
      staffProfileId: record.staff_profile_id,
      from: record.start_date,
      to: record.end_date,
      actorUserId,
      applicationId,
      includePast: revokeTakenDays === true,
    });

    // Without revokeTakenDays, fully taken (ends today or earlier): nothing comes back, so refuse rather
    // than report a cancellation that changed nothing. `revertLeaveRange`
    // deleted nothing here (its range starts tomorrow), and the throw rolls
    // back the caller's transaction, so the application stays APPROVED.
    if (!revokeTakenDays && record.end_date <= today) {
      throw new ConflictException({
        message: 'This leave has already been taken in full',
        details: { code: 'LEAVE_ALREADY_ENDED' },
      });
    }

    const old = { status: record.status, end_date: record.end_date, days: record.days };
    if (revokeTakenDays) {
      // Whole record voided; end_date and days stay so the audit shows what was revoked.
      record.status = LeaveStatus.CANCELLED;
    } else if (record.start_date <= today) {
      // Under way: the days up to today were taken and keep their LEAVE marks.
      record.end_date = today;
      record.days = await this.countWorkingDays(tenantId, record.start_date, today);
    }
    if (!revokeTakenDays && (record.start_date > today || record.days === 0))
      record.status = LeaveStatus.CANCELLED;
    await recordRepo.save(record);
    await this.auditService.record(
      {
        action: AuditAction.UPDATE,
        entity_type: 'LeaveRecord',
        entity_id: record.id,
        tenant_id: tenantId,
        performed_by_user_id: actorUserId,
        old_values: old,
        new_values: {
          status: record.status,
          end_date: record.end_date,
          days: record.days,
          reason,
          ...(revokeTakenDays ? { revoked_taken_days: true, reverted_dates: dates } : {}),
        },
      },
      manager,
    );
    return { leave_record_id: record.id, reverted_dates: dates };
  }
}

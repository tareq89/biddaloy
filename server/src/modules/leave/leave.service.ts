import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
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
import {
  CreateLeaveRequestDto,
  DecideLeaveRequestDto,
  LeaveBalanceDto,
  LeavePolicyDto,
  LeaveRecordDto,
} from './dto/leave.dto';

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

/** Inclusive day span between two `YYYY-MM-DD` dates. */
function inclusiveDays(startDate: string, endDate: string): number {
  const start = Date.UTC(
    Number(startDate.slice(0, 4)),
    Number(startDate.slice(5, 7)) - 1,
    Number(startDate.slice(8, 10)),
  );
  const end = Date.UTC(
    Number(endDate.slice(0, 4)),
    Number(endDate.slice(5, 7)) - 1,
    Number(endDate.slice(8, 10)),
  );
  return Math.round((end - start) / 86_400_000) + 1;
}

function currentYearRange(): { from: string; to: string } {
  const year = new Date().getUTCFullYear();
  return { from: `${year}-01-01`, to: `${year}-12-31` };
}

/** The calendar year a leave record's own `start_date` falls in — used for
 * the balance check instead of the current calendar year, so a leave
 * spanning (or requested near) a year boundary is checked against the year
 * it actually consumes quota in. `getBalance` (the read-only display
 * endpoint) is the one place that still defaults to the current year (D12). */
function yearRangeOf(date: string): { from: string; to: string } {
  const year = Number(date.slice(0, 4));
  return { from: `${year}-01-01`, to: `${year}-12-31` };
}

function toRecordDto(r: LeaveRecord): LeaveRecordDto {
  return {
    id: r.id,
    staff_profile_id: r.staff_profile_id,
    leave_type: r.leave_type,
    start_date: r.start_date,
    end_date: r.end_date,
    days: r.days,
    status: r.status,
    reason: r.reason,
    approved_by: r.approved_by,
    decided_at: r.decided_at,
  };
}

/**
 * [36.3] Request/approve/reject staff leave. Balance is always computed
 * live — `quota - sum(APPROVED days in the relevant year)`. See
 * `staff-attendance.service.ts` for the transaction+lock+audit pattern
 * `decide()`'s approve/reject paths mirror.
 */
@Injectable()
export class LeaveService {
  constructor(
    @InjectDataSource()
    private readonly dataSource: DataSource,
    @InjectRepository(LeaveRecord)
    private readonly leaveRecordRepo: Repository<LeaveRecord>,
    @InjectRepository(LeavePolicy)
    private readonly leavePolicyRepo: Repository<LeavePolicy>,
    @InjectRepository(StaffProfile)
    private readonly staffProfileRepo: Repository<StaffProfile>,
    private readonly auditService: AuditService,
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

  /** `quota - sum(APPROVED days this calendar year)`, computed live — no
   * stored counter (D12). Read-only display endpoint: intentionally always
   * the *current* year, unlike the request/decide balance checks which use
   * the leave's own year (see `yearRangeOf`). */
  async getBalance(
    tenantId: string,
    staffProfileId: string,
    leaveType: LeaveType,
  ): Promise<LeaveBalanceDto> {
    return this.computeBalance(
      this.leaveRecordRepo,
      tenantId,
      staffProfileId,
      leaveType,
      currentYearRange(),
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
    return Promise.all(
      types.map((leaveType) => this.getBalance(tenantId, staffProfileId, leaveType)),
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
      balance: policy.annual_quota_days - usedDays,
    };
  }

  private async approvedDaysInRange(
    repo: Repository<LeaveRecord>,
    tenantId: string,
    staffProfileId: string,
    leaveType: LeaveType,
    range: { from: string; to: string },
  ): Promise<number> {
    const { from, to } = range;
    const raw = await repo
      .createQueryBuilder('leave_record')
      .select('COALESCE(SUM(leave_record.days), 0)', 'sum')
      .where('leave_record.tenant_id = :tenantId', { tenantId })
      .andWhere('leave_record.staff_profile_id = :staffProfileId', { staffProfileId })
      .andWhere('leave_record.leave_type = :leaveType', { leaveType })
      .andWhere('leave_record.status = :status', { status: LeaveStatus.APPROVED })
      .andWhere('leave_record.start_date BETWEEN :from AND :to', { from, to })
      .getRawOne<{ sum: string }>();
    return Number(raw?.sum ?? 0);
  }

  async request(
    tenantId: string,
    dto: CreateLeaveRequestDto,
    callerUserId: string,
    role: UserRole,
  ): Promise<LeaveRecordDto> {
    if (!DATE_ONLY.test(dto.start_date) || !DATE_ONLY.test(dto.end_date)) {
      throw new BadRequestException('start_date/end_date must be YYYY-MM-DD');
    }
    const days = inclusiveDays(dto.start_date, dto.end_date);
    if (days < 1) {
      throw new BadRequestException('end_date must not be before start_date');
    }

    await this.assertStaffProfileAccessible(tenantId, dto.staff_profile_id, callerUserId, role);

    // Balance is checked against the year the leave's own start_date falls
    // in, not the current calendar year — a request straddling a year
    // boundary must not silently escape the quota it actually consumes.
    const balance = await this.computeBalance(
      this.leaveRecordRepo,
      tenantId,
      dto.staff_profile_id,
      dto.leave_type,
      yearRangeOf(dto.start_date),
    );
    if (days > balance.balance) {
      throw new UnprocessableEntityException({
        message: `Requesting ${days} day(s) would exceed the remaining balance of ${balance.balance}`,
        details: { code: 'LEAVE_BALANCE_EXCEEDED' },
      });
    }

    const created = await this.leaveRecordRepo.save(
      this.leaveRecordRepo.create({
        tenant_id: tenantId,
        staff_profile_id: dto.staff_profile_id,
        leave_type: dto.leave_type,
        start_date: dto.start_date,
        end_date: dto.end_date,
        days,
        status: LeaveStatus.PENDING,
        reason: dto.reason ?? null,
      }),
    );
    return toRecordDto(created);
  }

  /**
   * Both approve and reject wrap the status transition + audit write in one
   * transaction, pessimistic-locking the row(s) so a concurrent decide() on
   * the same record (approve/approve, approve/reject, or reject/reject)
   * cannot race past the PENDING re-check. Approve additionally locks every
   * one of the staff's records for that type/year, since it also has to
   * re-read a live balance sum.
   */
  async decide(
    tenantId: string,
    leaveRecordId: string,
    decidedByUserId: string,
    dto: DecideLeaveRequestDto,
    auditContext: { ip: string | null; userAgent: string | null },
  ): Promise<LeaveRecordDto> {
    if (!dto.approve) {
      return this.dataSource.transaction(async (manager) => {
        const recordRepo = manager.getRepository(LeaveRecord);

        const record = await recordRepo.findOne({
          where: { id: leaveRecordId, tenant_id: tenantId },
          lock: { mode: 'pessimistic_write' },
        });
        if (!record) {
          throw new NotFoundException('Leave record not found');
        }
        if (record.status !== LeaveStatus.PENDING) {
          throw new UnprocessableEntityException('Only a pending request can be decided');
        }

        const oldStatus = record.status;
        record.status = LeaveStatus.REJECTED;
        record.approved_by = decidedByUserId;
        record.decided_at = new Date();
        const saved = await recordRepo.save(record);

        await this.auditService.record(
          {
            action: AuditAction.UPDATE,
            entity_type: 'LeaveRecord',
            entity_id: saved.id,
            tenant_id: tenantId,
            performed_by_user_id: decidedByUserId,
            ip_address: auditContext.ip,
            user_agent: auditContext.userAgent,
            old_values: { status: oldStatus },
            new_values: { status: saved.status, reason: dto.reason ?? null },
          },
          manager,
        );

        return toRecordDto(saved);
      });
    }

    return this.dataSource.transaction(async (manager) => {
      const recordRepo = manager.getRepository(LeaveRecord);
      const policyRepo = manager.getRepository(LeavePolicy);

      const record = await recordRepo.findOne({
        where: { id: leaveRecordId, tenant_id: tenantId },
      });
      if (!record) {
        throw new NotFoundException('Leave record not found');
      }
      if (record.status !== LeaveStatus.PENDING) {
        throw new UnprocessableEntityException('Only a pending request can be decided');
      }

      // Pessimistic lock: every one of this staff member's records for this
      // leave type serializes here, so a second concurrent approval blocks
      // until this transaction commits (or rolls back) and then re-reads
      // the committed balance — it cannot see a stale, pre-approval sum.
      const lockedRecords = await recordRepo
        .createQueryBuilder('leave_record')
        .setLock('pessimistic_write')
        .where('leave_record.tenant_id = :tenantId', { tenantId })
        .andWhere('leave_record.staff_profile_id = :staffProfileId', {
          staffProfileId: record.staff_profile_id,
        })
        .andWhere('leave_record.leave_type = :leaveType', { leaveType: record.leave_type })
        .orderBy('leave_record.id')
        .getMany();

      // Re-check status under the lock: a concurrent decide() on this same
      // record may have committed while we were blocked acquiring the lock
      // above. The pre-lock `record` read at the top of this function is
      // stale once that happens — trust only the row we just locked.
      const lockedRecord = lockedRecords.find((r) => r.id === record.id);
      if (!lockedRecord || lockedRecord.status !== LeaveStatus.PENDING) {
        throw new UnprocessableEntityException('Only a pending request can be decided');
      }
      record.status = lockedRecord.status;

      const policy = await policyRepo.findOne({
        where: { tenant_id: tenantId, leave_type: record.leave_type },
      });
      if (!policy) {
        throw new NotFoundException(`No leave policy for ${record.leave_type} in this tenant`);
      }
      // Balance is checked against the year the leave's own start_date
      // falls in, not the current calendar year (see `request()`).
      const usedDays = await this.approvedDaysInRange(
        recordRepo,
        tenantId,
        record.staff_profile_id,
        record.leave_type,
        yearRangeOf(record.start_date),
      );
      const balance = policy.annual_quota_days - usedDays;
      if (record.days > balance) {
        throw new UnprocessableEntityException({
          message: `Approving would exceed the remaining balance of ${balance}`,
          details: { code: 'LEAVE_BALANCE_EXCEEDED' },
        });
      }

      const oldStatus = record.status;
      record.status = LeaveStatus.APPROVED;
      record.approved_by = decidedByUserId;
      record.decided_at = new Date();
      const saved = await recordRepo.save(record);

      await this.auditService.record(
        {
          action: AuditAction.UPDATE,
          entity_type: 'LeaveRecord',
          entity_id: saved.id,
          tenant_id: tenantId,
          performed_by_user_id: decidedByUserId,
          ip_address: auditContext.ip,
          user_agent: auditContext.userAgent,
          old_values: { status: oldStatus },
          new_values: { status: saved.status, reason: dto.reason ?? null },
        },
        manager,
      );

      return toRecordDto(saved);
    });
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
    annualQuotaDays: number,
  ): Promise<LeavePolicyDto> {
    const policy = await this.getPolicy(tenantId, leaveType);
    policy.annual_quota_days = annualQuotaDays;
    const saved = await this.leavePolicyRepo.save(policy);
    return { leave_type: saved.leave_type, annual_quota_days: saved.annual_quota_days };
  }
}

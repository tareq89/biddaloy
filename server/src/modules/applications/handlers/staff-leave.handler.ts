import {
  ConflictException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import type { EntityManager } from 'typeorm';
import { LeaveStatus } from '@biddaloy/shared';
import type { Application } from '../entities/application.entity';
import type { ApplicationEffectContext } from '../application-types';
import type { StaffLeavePayloadDto } from '../dto/payloads/staff-leave.dto';
import { LeaveService } from '../../leave/leave.service';
import { LeaveRecord } from '../../leave/entities/leave-record.entity';
import { StaffProfile } from '../../staff-profiles/entities/staff-profile.entity';
import { Teacher } from '../../academics/entities/teacher.entity';

/** [52.3.2] Approving STAFF_LEAVE writes the ledger row + LEAVE marks; cancel gives them back (D31). */
@Injectable()
export class StaffLeaveHandler {
  constructor(private readonly leaveService: LeaveService) {}

  async apply(
    manager: EntityManager,
    app: Application,
    ctx: ApplicationEffectContext,
  ): Promise<Record<string, unknown> | null> {
    const p = app.payload as unknown as StaffLeavePayloadDto;
    // The `date` columns, not the payload strings (as the student handler): Postgres already
    // cut them to YYYY-MM-DD, so a datetime-shaped payload date cannot count zero days.
    const { start_date: start, end_date: end } = app;
    if (!start || !end) {
      throw new UnprocessableEntityException('Leave application has no date range');
    }
    const staffProfileId = app.subject_staff_profile_id;
    if (!staffProfileId) {
      throw new NotFoundException('Staff profile not found');
    }

    // Serializes concurrent approvals for this person (same lock the helper takes; re-entrant).
    const profile = await manager.getRepository(StaffProfile).findOne({
      where: { id: staffProfileId, tenant_id: ctx.tenantId },
      lock: { mode: 'for_no_key_update' },
    });
    if (!profile) {
      throw new NotFoundException('Staff profile not found');
    }

    // D11: strict overlap with an APPROVED leave of any type; adjacent days pass.
    const overlap = await manager
      .getRepository(LeaveRecord)
      .createQueryBuilder('l')
      .where('l.tenant_id = :t', { t: ctx.tenantId })
      .andWhere('l.staff_profile_id = :s', { s: staffProfileId })
      .andWhere('l.status = :st', { st: LeaveStatus.APPROVED })
      .andWhere('l.start_date <= :end AND l.end_date >= :start', {
        start,
        end,
      })
      .getCount();
    if (overlap > 0) {
      throw new ConflictException({
        message: 'This leave overlaps an approved leave',
        details: { code: 'LEAVE_OVERLAP' },
      });
    }

    const r = await this.leaveService.recordApprovedLeave(manager, {
      tenantId: ctx.tenantId,
      staffProfileId,
      leaveType: p.leave_type,
      startDate: start,
      endDate: end,
      reason: p.reason,
      applicationId: app.id,
      approvedByUserId: ctx.actorUserId,
    });

    // D32: a teacher's leave points the approver at the substitutions screen.
    const teacher = await manager
      .getRepository(Teacher)
      .findOne({ where: { tenant_id: ctx.tenantId, user_id: profile.user_id } });
    return {
      leave_record_id: r.leave_record_id,
      days: r.days,
      attendance_dates: r.attendance_dates,
      ...(teacher
        ? {
            follow_up: {
              kind: 'SUBSTITUTE',
              from: start,
              to: end,
              covered_for_teacher_id: teacher.id,
            },
          }
        : {}),
    };
  }

  async cancel(
    manager: EntityManager,
    app: Application,
    ctx: ApplicationEffectContext,
  ): Promise<void> {
    await this.leaveService.cancelApprovedLeave(manager, {
      tenantId: ctx.tenantId,
      applicationId: app.id,
      actorUserId: ctx.actorUserId,
      reason: ctx.reason ?? null,
    });
  }
}

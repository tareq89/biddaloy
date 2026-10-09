import {
  ConflictException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import type { EntityManager } from 'typeorm';
import { ApplicationStatus, ApplicationType } from '@biddaloy/shared';
import { Application } from '../entities/application.entity';
import type { ApplicationEffectContext } from '../application-types';
import type { StudentLeavePayloadDto } from '../dto/payloads/student-leave.dto';
import { AttendanceService } from '../../attendance/attendance.service';
import { Student } from '../../students/entities/student.entity';

/** [52.3.2] Approving STUDENT_LEAVE stamps LEAVE on the register (D21/D36); cancel takes future marks back. */
@Injectable()
export class StudentLeaveHandler {
  constructor(private readonly attendanceService: AttendanceService) {}

  async apply(
    manager: EntityManager,
    app: Application,
    ctx: ApplicationEffectContext,
  ): Promise<Record<string, unknown> | null> {
    const p = app.payload as unknown as StudentLeavePayloadDto;
    const studentId = app.subject_student_id;
    if (!studentId) {
      throw new NotFoundException('Student not found');
    }

    // Lock order: the application row is already held by the decision; then this student row.
    const student = await manager.getRepository(Student).findOne({
      where: { id: studentId, tenant_id: ctx.tenantId },
      lock: { mode: 'for_no_key_update' },
    });
    if (!student) {
      throw new NotFoundException('Student not found');
    }

    const overlap = await manager
      .getRepository(Application)
      .createQueryBuilder('a')
      .where('a.tenant_id = :t', { t: ctx.tenantId })
      .andWhere('a.type = :type', { type: ApplicationType.STUDENT_LEAVE })
      .andWhere('a.status = :st', { st: ApplicationStatus.APPROVED })
      .andWhere('a.subject_student_id = :s', { s: studentId })
      .andWhere('a.id != :id', { id: app.id })
      .andWhere('a.start_date <= :end AND a.end_date >= :start', {
        start: p.start_date,
        end: p.end_date,
      })
      .getCount();
    if (overlap > 0) {
      throw new ConflictException({
        message: 'This leave overlaps an approved leave',
        details: { code: 'LEAVE_OVERLAP' },
      });
    }

    const { dates } = await this.attendanceService.markLeaveRange(manager, {
      tenantId: ctx.tenantId,
      studentId,
      from: p.start_date,
      to: p.end_date,
      actorUserId: ctx.actorUserId,
      applicationId: app.id,
    });
    // Mirrors staff leave: a range with no working day is a mistake, not an empty approval.
    if (dates.length === 0) {
      throw new UnprocessableEntityException({
        message: 'The selected dates contain no working days',
        details: { code: 'LEAVE_NO_WORKING_DAYS' },
      });
    }
    return { days: dates.length, attendance_dates: dates };
  }

  async cancel(
    manager: EntityManager,
    app: Application,
    ctx: ApplicationEffectContext,
  ): Promise<void> {
    const p = app.payload as unknown as StudentLeavePayloadDto;
    if (!app.subject_student_id) {
      throw new NotFoundException('Student not found');
    }
    await this.attendanceService.revertLeaveRange(manager, {
      tenantId: ctx.tenantId,
      studentId: app.subject_student_id,
      from: p.start_date,
      to: p.end_date,
      actorUserId: ctx.actorUserId,
      applicationId: app.id,
    });
  }
}

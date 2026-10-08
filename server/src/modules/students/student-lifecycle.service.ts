import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, IsNull, Not, Repository } from 'typeorm';
import {
  AuditAction,
  EnrollmentStatus,
  LIFECYCLE_EVENT_TARGET_STATUS,
  StudentLifecycleEventType,
} from '@biddaloy/shared';
import { RequestContext } from '../../common/request-context.util';
import { AuditService } from '../audit/audit.service';
import { EnrollmentService } from '../enrollments/enrollments.service';
import { AcademicYear } from '../academics/entities/academic-year.entity';
import { Class } from '../academics/entities/class.entity';
import { ClassSection } from '../academics/entities/class-section.entity';
import { Enrollment } from './entities/enrollment.entity';
import { Student } from './entities/student.entity';
import { StudentLifecycleEvent } from './entities/student-lifecycle-event.entity';
import { LeaveStudentDto, ReadmitStudentDto } from './dto/student-lifecycle.dto';
import { nextRollNumber } from './roll-number.util';
import { lockSeatUsage, seatLimitError } from '../schools/trial/seat-limit.service';

export interface RecordLifecycleEventInput {
  tenant_id: string;
  student_id: string;
  enrollment_id: string;
  academic_year_id: string;
  event_type: StudentLifecycleEventType;
  occurred_on: string;
  reason: string;
  destination?: string | null;
  remark?: string | null;
  recorded_by_user_id: string | null;
}

/**
 * [39.2.1] Leave / readmit. Each operation runs in ONE transaction that writes the
 * lifecycle event, `enrollments.enrollment_status`, `students.enrollment_status`
 * and the audit rows. Fee generation bills on `students.enrollment_status`
 * (fee-generation.service.ts), so writing that column is what stops billing.
 */
@Injectable()
export class StudentLifecycleService {
  constructor(
    @InjectRepository(StudentLifecycleEvent)
    private readonly eventRepo: Repository<StudentLifecycleEvent>,
    private readonly enrollmentService: EnrollmentService,
    private readonly auditService: AuditService,
  ) {}

  /** Insert only, no validation. Reused by the promotion hook (#1187). */
  async recordEvent(
    manager: EntityManager,
    input: RecordLifecycleEventInput,
  ): Promise<StudentLifecycleEvent> {
    const repo = manager.getRepository(StudentLifecycleEvent);
    return repo.save(
      repo.create({
        ...input,
        destination: input.destination ?? null,
        remark: input.remark ?? null,
      }),
    );
  }

  async leave(
    studentId: string,
    dto: LeaveStudentDto,
    tenantId: string,
    userId: string | null,
    context: RequestContext,
  ): Promise<StudentLifecycleEvent> {
    return this.eventRepo.manager.transaction(async (manager) => {
      const student = await this.lockStudent(manager, studentId, tenantId);

      const enrollmentRepo = manager.getRepository(Enrollment);
      const enrollment = await enrollmentRepo.findOne({
        where: {
          student_id: studentId,
          tenant_id: tenantId,
          enrollment_status: EnrollmentStatus.ACTIVE,
        },
        relations: ['academic_year'],
        order: { academic_year: { start_date: { direction: 'DESC', nulls: 'LAST' } } },
      });
      if (!enrollment) {
        throw new ConflictException('Student has no active enrollment');
      }

      const targetStatus = LIFECYCLE_EVENT_TARGET_STATUS[dto.type];

      const event = await this.recordEvent(manager, {
        tenant_id: tenantId,
        student_id: studentId,
        enrollment_id: enrollment.id,
        academic_year_id: enrollment.academic_year_id,
        event_type: dto.type,
        occurred_on: dto.occurred_on,
        reason: dto.reason,
        destination: dto.destination,
        remark: dto.remark,
        recorded_by_user_id: userId,
      });

      await enrollmentRepo.update(
        { id: enrollment.id, tenant_id: tenantId },
        { enrollment_status: targetStatus },
      );
      await manager
        .getRepository(Student)
        .update({ id: studentId, tenant_id: tenantId }, { enrollment_status: targetStatus });

      await this.auditService.record(
        {
          action: AuditAction.UPDATE,
          entity_type: 'Enrollment',
          entity_id: enrollment.id,
          tenant_id: tenantId,
          performed_by_user_id: userId,
          ip_address: context.ip,
          user_agent: context.userAgent,
          old_values: { enrollment_status: enrollment.enrollment_status },
          new_values: { enrollment_status: targetStatus },
        },
        manager,
      );
      await this.auditService.record(
        {
          action: AuditAction.UPDATE,
          entity_type: 'Student',
          entity_id: studentId,
          tenant_id: tenantId,
          performed_by_user_id: userId,
          ip_address: context.ip,
          user_agent: context.userAgent,
          old_values: { enrollment_status: student.enrollment_status },
          new_values: {
            enrollment_status: targetStatus,
            lifecycle_event_id: event.id,
            lifecycle_event_type: dto.type,
            occurred_on: dto.occurred_on,
          },
        },
        manager,
      );

      return event;
    });
  }

  async readmit(
    studentId: string,
    dto: ReadmitStudentDto,
    tenantId: string,
    userId: string | null,
    context: RequestContext,
  ): Promise<StudentLifecycleEvent> {
    return this.eventRepo.manager.transaction(async (manager) => {
      // [13.2.3] Re-activating takes a seat. School lock first, then the student row: the same
      // order StudentService.create uses, so the two can never deadlock. The seat check runs
      // after "already active": that student already holds a seat.
      const seats = await lockSeatUsage(manager, tenantId);
      const student = await this.lockStudent(manager, studentId, tenantId);
      if (student.enrollment_status === EnrollmentStatus.ACTIVE) {
        throw new ConflictException('Student is already active');
      }
      if (seats.limit !== null && seats.used + 1 > seats.limit) {
        throw seatLimitError(seats.used, seats.limit, 1);
      }

      const section = await manager.getRepository(ClassSection).findOne({
        where: { id: dto.class_section_id, tenant_id: tenantId, deleted_at: IsNull() },
      });
      if (!section) {
        throw new NotFoundException(`Class section "${dto.class_section_id}" not found`);
      }
      const cls = await manager.getRepository(Class).findOne({
        where: { id: section.class_id, tenant_id: tenantId, deleted_at: IsNull() },
      });
      if (!cls) {
        throw new NotFoundException(`Class "${section.class_id}" not found`);
      }
      const yearId = cls.academic_year_id;
      const year = await manager.getRepository(AcademicYear).findOne({
        where: { id: yearId, tenant_id: tenantId, deleted_at: IsNull() },
      });
      if (!year) {
        throw new NotFoundException(`Academic year "${yearId}" not found`);
      }
      if (dto.academic_year_id && dto.academic_year_id !== yearId) {
        throw new BadRequestException('class_section_id does not belong to academic_year_id');
      }

      const enrollmentRepo = manager.getRepository(Enrollment);
      const activeInYear = await enrollmentRepo.findOne({
        where: {
          student_id: studentId,
          tenant_id: tenantId,
          academic_year_id: yearId,
          enrollment_status: EnrollmentStatus.ACTIVE,
        },
      });
      if (activeInYear) {
        throw new ConflictException(
          `Student is already actively enrolled in academic year "${yearId}"`,
        );
      }

      const studentRepo = manager.getRepository(Student);
      const previous = await enrollmentRepo.findOne({
        where: {
          student_id: studentId,
          tenant_id: tenantId,
          academic_year_id: yearId,
          enrollment_status: Not(EnrollmentStatus.ACTIVE),
        },
        order: { updated_at: 'DESC' },
      });

      let enrollmentId: string;
      if (previous) {
        // Same year: reactivate the existing row (D16).
        const oldValues: Record<string, unknown> = {
          enrollment_status: previous.enrollment_status,
        };
        const newValues: Record<string, unknown> = { enrollment_status: EnrollmentStatus.ACTIVE };
        if (previous.class_id !== cls.id) {
          oldValues.class_id = previous.class_id;
          newValues.class_id = cls.id;
        }
        if (previous.section_id !== section.id) {
          oldValues.section_id = previous.section_id;
          newValues.section_id = section.id;
        }
        await enrollmentRepo.update(
          { id: previous.id, tenant_id: tenantId },
          { enrollment_status: EnrollmentStatus.ACTIVE, class_id: cls.id, section_id: section.id },
        );
        if (student.class_section_id !== section.id) {
          const roll = await nextRollNumber(manager, section.id, tenantId);
          await studentRepo.update(
            { id: studentId, tenant_id: tenantId },
            { class_section_id: section.id, roll_number: roll },
          );
        }
        await this.auditService.record(
          {
            action: AuditAction.UPDATE,
            entity_type: 'Enrollment',
            entity_id: previous.id,
            tenant_id: tenantId,
            performed_by_user_id: userId,
            ip_address: context.ip,
            user_agent: context.userAgent,
            old_values: oldValues,
            new_values: newValues,
          },
          manager,
        );
        enrollmentId = previous.id;
      } else {
        // Other year: new enrollment. createInTransaction moves section/roll and audits the CREATE.
        const created = await this.enrollmentService.createInTransaction(
          manager,
          {
            student_id: studentId,
            class_id: cls.id,
            section_id: section.id,
            academic_year_id: yearId,
          },
          tenantId,
          userId,
          context,
        );
        enrollmentId = created.id;
      }

      await studentRepo.update(
        { id: studentId, tenant_id: tenantId },
        { enrollment_status: EnrollmentStatus.ACTIVE },
      );

      const event = await this.recordEvent(manager, {
        tenant_id: tenantId,
        student_id: studentId,
        enrollment_id: enrollmentId,
        academic_year_id: yearId,
        event_type: 'READMITTED',
        occurred_on: dto.occurred_on,
        reason: dto.reason ?? '', // column is NOT NULL
        remark: dto.remark ?? null,
        destination: null,
        recorded_by_user_id: userId,
      });

      await this.auditService.record(
        {
          action: AuditAction.UPDATE,
          entity_type: 'Student',
          entity_id: studentId,
          tenant_id: tenantId,
          performed_by_user_id: userId,
          ip_address: context.ip,
          user_agent: context.userAgent,
          old_values: { enrollment_status: student.enrollment_status },
          new_values: {
            enrollment_status: EnrollmentStatus.ACTIVE,
            lifecycle_event_id: event.id,
            lifecycle_event_type: 'READMITTED',
            occurred_on: dto.occurred_on,
          },
        },
        manager,
      );

      return event;
    });
  }

  async listEvents(studentId: string, tenantId: string): Promise<StudentLifecycleEvent[]> {
    const student = await this.eventRepo.manager
      .getRepository(Student)
      .findOne({ where: { id: studentId, tenant_id: tenantId, deleted_at: IsNull() } });
    if (!student) {
      throw new NotFoundException(`Student with ID "${studentId}" not found`);
    }
    return this.eventRepo.find({
      where: { student_id: studentId, tenant_id: tenantId },
      order: { occurred_on: 'DESC', created_at: 'DESC' },
    });
  }

  /** Row lock serializes concurrent leave/readmit. No relations: FOR UPDATE + outer join fails. */
  private async lockStudent(
    manager: EntityManager,
    studentId: string,
    tenantId: string,
  ): Promise<Student> {
    const student = await manager.getRepository(Student).findOne({
      where: { id: studentId, tenant_id: tenantId, deleted_at: IsNull() },
      lock: { mode: 'pessimistic_write' },
    });
    if (!student) {
      throw new NotFoundException(`Student with ID "${studentId}" not found`);
    }
    return student;
  }
}

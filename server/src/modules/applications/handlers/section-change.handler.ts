import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { IsNull, type EntityManager } from 'typeorm';
import { EnrollmentStatus } from '@biddaloy/shared';
import type { Application } from '../entities/application.entity';
import type { ApplicationEffectContext } from '../application-types';
import type { SectionChangePayloadDto } from '../dto/payloads/section-change.dto';
import { EnrollmentService } from '../../enrollments/enrollments.service';
import { Enrollment } from '../../students/entities/enrollment.entity';
import { ClassSection } from '../../academics/entities/class-section.entity';
import { Student } from '../../students/entities/student.entity';
import { requestContext } from '../../../common/request-context.util';

/** [52.3.3] Approving SECTION_CHANGE moves the student's active enrollment to another section. */
@Injectable()
export class SectionChangeHandler {
  constructor(private readonly enrollments: EnrollmentService) {}

  async apply(
    manager: EntityManager,
    app: Application,
    ctx: ApplicationEffectContext,
  ): Promise<Record<string, unknown> | null> {
    const p = app.payload as unknown as SectionChangePayloadDto;
    const studentId = app.subject_student_id;
    const student = studentId
      ? await manager.getRepository(Student).findOne({
          where: { id: studentId, tenant_id: ctx.tenantId, deleted_at: IsNull() },
          // Lock order: application (held by the decision) -> student. No school lock needed here.
          lock: { mode: 'pessimistic_write' },
        })
      : null;
    if (!student) throw new NotFoundException('Student not found');

    const enrollment = await manager.getRepository(Enrollment).findOne({
      where: {
        student_id: student.id,
        tenant_id: ctx.tenantId,
        enrollment_status: EnrollmentStatus.ACTIVE,
      },
      relations: ['academic_year'],
      order: { academic_year: { start_date: { direction: 'DESC', nulls: 'LAST' } } },
    });
    if (!enrollment) {
      throw new ConflictException({
        message: 'Student has no active enrollment',
        details: { code: 'NO_ACTIVE_ENROLLMENT' },
      });
    }

    const section = await manager.getRepository(ClassSection).findOne({
      where: { id: p.to_section_id, tenant_id: ctx.tenantId, deleted_at: IsNull() },
    });
    if (!section) throw new NotFoundException('Section not found');
    if (section.id === enrollment.section_id) {
      throw new ConflictException({
        message: 'The student is already in this section',
        details: { code: 'SECTION_UNCHANGED' },
      });
    }

    // Rejects a class from another academic year (400) and audits the move.
    await this.enrollments.update(
      enrollment.id,
      { class_id: section.class_id, section_id: section.id },
      ctx.tenantId,
      ctx.actorUserId,
      requestContext(ctx.req),
      manager,
    );
    return {
      enrollment_id: enrollment.id,
      from_section_id: enrollment.section_id,
      to_section_id: section.id,
    };
  }
}

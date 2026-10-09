import { Injectable, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import type { EntityManager } from 'typeorm';
import type { Application } from '../entities/application.entity';
import type { ApplicationEffectContext } from '../application-types';
import type { ReadmissionPayloadDto } from '../dto/payloads/readmission.dto';
import { StudentLifecycleService } from '../../students/student-lifecycle.service';
import { requestContext } from '../../../common/request-context.util';
import { todayInSchoolTz } from '../../../common/time';

/** [52.3.3] Approving READMISSION re-activates the student in the decision's transaction. */
@Injectable()
export class ReadmissionHandler {
  constructor(private readonly lifecycle: StudentLifecycleService) {}

  async apply(
    manager: EntityManager,
    app: Application,
    ctx: ApplicationEffectContext,
  ): Promise<Record<string, unknown> | null> {
    const p = app.payload as unknown as ReadmissionPayloadDto;
    if (!app.subject_student_id) throw new NotFoundException('Student not found');
    // The HTTP DTO's IsNotFutureDate does not run on a direct service call.
    // The payload DTO accepts datetime strings; compare and store the date part only.
    const occurredOn = p.occurred_on.slice(0, 10);
    if (occurredOn > todayInSchoolTz()) {
      throw new UnprocessableEntityException({
        message: 'The readmission date cannot be in the future',
        details: { code: 'DATE_IN_FUTURE' },
      });
    }
    // readmit takes the school lock then the student lock itself (order: application -> school -> student).
    const event = await this.lifecycle.readmit(
      app.subject_student_id,
      { occurred_on: occurredOn, class_section_id: p.class_section_id, reason: p.reason },
      ctx.tenantId,
      ctx.actorUserId,
      requestContext(ctx.req),
      manager,
    );
    return { lifecycle_event_id: event.id };
  }
}

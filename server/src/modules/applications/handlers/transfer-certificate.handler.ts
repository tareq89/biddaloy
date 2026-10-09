import { Injectable, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import type { EntityManager } from 'typeorm';
import { DocumentKind } from '@biddaloy/shared';
import type { Application } from '../entities/application.entity';
import type { ApplicationEffectContext } from '../application-types';
import type { TransferCertificatePayloadDto } from '../dto/payloads/transfer-certificate.dto';
import { StudentLifecycleService } from '../../students/student-lifecycle.service';
import { requestContext } from '../../../common/request-context.util';
import { todayInSchoolTz } from '../../../common/time';

/** [52.3.3] Approving TRANSFER_CERTIFICATE marks the student TRANSFERRED_OUT; the certificate itself stays manual (D17). */
@Injectable()
export class TransferCertificateHandler {
  constructor(private readonly lifecycle: StudentLifecycleService) {}

  async apply(
    manager: EntityManager,
    app: Application,
    ctx: ApplicationEffectContext,
  ): Promise<Record<string, unknown> | null> {
    const p = app.payload as unknown as TransferCertificatePayloadDto;
    const studentId = app.subject_student_id;
    if (!studentId) throw new NotFoundException('Student not found');
    // The payload DTO accepts datetime strings; compare and store the date part only.
    const leavingDate = p.leaving_date.slice(0, 10);
    if (leavingDate > todayInSchoolTz()) {
      throw new UnprocessableEntityException({
        message: 'The leaving date cannot be in the future',
        details: { code: 'DATE_IN_FUTURE' },
      });
    }
    const event = await this.lifecycle.leave(
      studentId,
      {
        type: 'TRANSFERRED_OUT',
        occurred_on: leavingDate,
        reason: p.reason,
        destination: p.destination,
      },
      ctx.tenantId,
      ctx.actorUserId,
      requestContext(ctx.req),
      manager,
    );
    return {
      lifecycle_event_id: event.id,
      follow_up: {
        kind: 'PRINT',
        document_kind: DocumentKind.TRANSFER_CERTIFICATE,
        subject_type: 'STUDENT',
        subject_ids: [studentId],
      },
    };
  }
}

import { Injectable, InternalServerErrorException, NotFoundException } from '@nestjs/common';
import { IsNull, type EntityManager } from 'typeorm';
import { ApplicationType, DocumentKind } from '@biddaloy/shared';
import type { Application } from '../entities/application.entity';
import type { ApplicationEffectContext } from '../application-types';
import type { ScriptRecheckPayloadDto } from '../dto/payloads/script-recheck.dto';
import { Student } from '../../students/entities/student.entity';

const printOf = (documentKind: string, subjectType: 'STUDENT' | 'STAFF', id: string | null) => {
  if (!id) throw new NotFoundException('Subject not found');
  return {
    follow_up: {
      kind: 'PRINT',
      document_kind: documentKind,
      subject_type: subjectType,
      subject_ids: [id],
    },
  };
};

/** [52.3.3] TESTIMONIAL, ID_CARD_REPRINT, SCRIPT_RECHECK: no writes, only a prefilled follow-up (D17). */
@Injectable()
export class ManualHandler {
  async apply(
    manager: EntityManager,
    app: Application,
    ctx: ApplicationEffectContext,
  ): Promise<Record<string, unknown> | null> {
    switch (app.type) {
      case ApplicationType.TESTIMONIAL:
        return printOf(DocumentKind.TESTIMONIAL, 'STUDENT', app.subject_student_id);
      case ApplicationType.ID_CARD_REPRINT:
        return app.subject_student_id
          ? printOf(DocumentKind.STUDENT_ID_CARD, 'STUDENT', app.subject_student_id)
          : printOf(DocumentKind.STAFF_ID_CARD, 'STAFF', app.subject_staff_profile_id);
      case ApplicationType.SCRIPT_RECHECK: {
        const p = app.payload as unknown as ScriptRecheckPayloadDto;
        const student = app.subject_student_id
          ? await manager.getRepository(Student).findOne({
              where: { id: app.subject_student_id, tenant_id: ctx.tenantId, deleted_at: IsNull() },
            })
          : null;
        if (!student) throw new NotFoundException('Student not found');
        return {
          follow_up: {
            kind: 'MARKS',
            exam_id: p.exam_id,
            section_id: student.class_section_id,
            subject_id: p.subject_id,
          },
        };
      }
      default:
        throw new InternalServerErrorException(`ManualHandler called for ${app.type}`);
    }
  }
}

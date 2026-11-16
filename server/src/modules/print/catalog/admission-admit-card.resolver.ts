import type { EntityManager } from 'typeorm';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { DocumentKind } from '@biddaloy/shared';
import type { FieldResolver, PrintContext, ResolvedSubject } from './field-resolver';
import { blankValues, schoolValues } from './field-values';

interface Row {
  id: string;
  applicant_name: string;
  reference_number: string;
  roll_number: string;
  guardian_phone: string;
  father_name: string | null;
  photo_key: string | null;
}

/**
 * [71.5.01] Admit card of an admission applicant. Subject = applicant id, context = the stage
 * (its round gives the class and title; its date/time/venue are on the card). Only applicants of
 * that stage's round who paid (not FEE_PENDING) and hold a roll resolve; anyone else, or another
 * tenant's id, is "not found".
 */
export class AdmissionAdmitCardResolver implements FieldResolver {
  kind = DocumentKind.ADMISSION_ADMIT_CARD;
  subjectType = 'APPLICANT' as const;

  async resolve(
    tenantId: string,
    subjectIds: string[],
    manager: EntityManager,
    _callerId?: string,
    context?: PrintContext,
  ) {
    if (context?.type !== 'ADMISSION_STAGE') {
      throw new BadRequestException('Admission admit cards need a stage');
    }
    const [stage] = (await manager.query(
      `SELECT s.id, s.intake_id, s.position, s.title, s.kind, s.config,
              i.title AS round_title, c.name AS class_name
         FROM admission_stages s
         JOIN admission_intakes i ON i.id = s.intake_id AND i.tenant_id = s.tenant_id
         LEFT JOIN classes c ON c.id = i.class_id AND c.tenant_id = s.tenant_id
        WHERE s.tenant_id = $1 AND s.id = $2 AND s.deleted_at IS NULL AND i.deleted_at IS NULL`,
      [tenantId, context.id],
    )) as {
      intake_id: string;
      position: number;
      title: string | null;
      kind: string;
      config: Record<string, unknown> | null;
      round_title: string;
      class_name: string | null;
    }[];
    if (!stage) throw new NotFoundException('Admission stage not found');

    // Same roster rule as the desk: after the first real stage, only those who passed the one before.
    const [prev] = (await manager.query(
      `SELECT id FROM admission_stages
        WHERE tenant_id = $1 AND intake_id = $2 AND deleted_at IS NULL
          AND position < $3 AND kind <> 'NONE' ORDER BY position DESC LIMIT 1`,
      [tenantId, stage.intake_id, stage.position],
    )) as { id: string }[];
    const rows: Row[] = await manager.query(
      `SELECT a.id, a.applicant_name, a.reference_number, a.roll_number, a.guardian_phone,
              a.extra_fields->>'father_name' AS father_name,
              (SELECT d->>'storage_key' FROM jsonb_array_elements(a.documents) d
                WHERE d->>'type' = 'PHOTO' LIMIT 1) AS photo_key
         FROM admission_applicants a
        WHERE a.tenant_id = $1 AND a.intake_id = $2 AND a.deleted_at IS NULL
          AND a.status <> 'FEE_PENDING' AND a.roll_number IS NOT NULL
          AND ($4::uuid IS NULL OR EXISTS (
                SELECT 1 FROM admission_stage_results p
                 WHERE p.tenant_id = $1 AND p.stage_id = $4 AND p.applicant_id = a.id
                   AND p.passed = true AND p.deleted_at IS NULL))
          AND a.id = ANY($3::uuid[])`,
      [tenantId, stage.intake_id, subjectIds, prev?.id ?? null],
    );
    const school = await schoolValues(tenantId, manager);
    const str = (v: unknown) => (typeof v === 'string' ? v : '');
    const cfg = stage.config ?? {};
    const out = new Map<string, ResolvedSubject>();
    for (const r of rows) {
      out.set(r.id, {
        label: r.applicant_name,
        photoKey: r.photo_key,
        values: {
          ...blankValues(this.kind),
          ...school,
          'applicant.name': r.applicant_name,
          'applicant.reference_number': r.reference_number,
          'applicant.roll': r.roll_number,
          'applicant.guardian_phone': r.guardian_phone,
          'applicant.father_name': r.father_name ?? '',
          'applicant.class': stage.class_name ?? '',
          'admission.round_title': stage.round_title,
          'admission.stage_name': stage.title ?? '',
          'admission.test_date': str(cfg.date),
          'admission.test_time': str(cfg.start_time),
          'admission.venue': str(cfg.venue),
        },
      });
    }
    return out;
  }
}

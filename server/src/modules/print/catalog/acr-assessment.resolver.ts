import { ConflictException } from '@nestjs/common';
import type { EntityManager } from 'typeorm';
import { ACR_CRITERIA_SLOTS, DocumentKind } from '@biddaloy/shared';
import type { FieldResolver, ResolvedSubject } from './field-resolver';
import { SCHOOL_TZ } from '../../../common/time';
import { blankValues, schoolValues } from './field-values';

interface Row {
  id: string;
  status: string;
  total: number | null;
  full_name: string;
  name_bn: string | null;
  designation: string | null;
  year_name: string;
  completed_on: string | null;
}

interface Crit {
  assessment_id: string;
  label_en: string;
  label_bn: string;
  score: number | null;
}

/**
 * Subject id = acr_assessments.id. ACR is confidential, so the caller's OWN
 * assessment resolves as missing (same 404 as the ACR API), an incomplete one is
 * refused (409), and a form with more criteria than template slots is refused
 * rather than silently truncated.
 */
export class AcrAssessmentResolver implements FieldResolver {
  kind = DocumentKind.ACR_ASSESSMENT;
  subjectType = 'ACR' as const;

  async resolve(tenantId: string, subjectIds: string[], manager: EntityManager, callerId?: string) {
    const rows: Row[] = await manager.query(
      `SELECT a.id, a.status, a.total, u.full_name, h.name_bn,
              d.title_en AS designation, y.name AS year_name,
              to_char(a.completed_at AT TIME ZONE $4::text, 'YYYY-MM-DD') AS completed_on
         FROM acr_assessments a
         JOIN users u ON u.id = a.user_id
         JOIN academic_years y ON y.id = a.academic_year_id AND y.tenant_id = a.tenant_id
         LEFT JOIN staff_hr_records h ON h.user_id = u.id AND h.tenant_id = a.tenant_id
         LEFT JOIN LATERAL (
           SELECT d2.title_en FROM staff_designation_history sh
             JOIN designations d2 ON d2.id = sh.designation_id
            WHERE sh.user_id = u.id AND sh.tenant_id = a.tenant_id AND sh.end_date IS NULL
            ORDER BY sh.effective_date DESC LIMIT 1) d ON true
        WHERE a.tenant_id = $1 AND a.id = ANY($2::uuid[])
          AND ($3::uuid IS NULL OR a.user_id <> $3::uuid)
        FOR SHARE OF a`, // a concurrent reopen waits until this print's transaction ends
      [tenantId, subjectIds, callerId ?? null, SCHOOL_TZ],
    );
    if (rows.some((r) => r.status !== 'COMPLETED')) {
      throw new ConflictException('ACR is not completed');
    }

    const crit: Crit[] = rows.length
      ? await manager.query(
          `SELECT a.id AS assessment_id, c.label_en, c.label_bn, s.score
             FROM acr_assessments a
             JOIN acr_criteria c ON c.form_version_id = a.form_version_id AND c.tenant_id = a.tenant_id
             LEFT JOIN acr_scores s ON s.assessment_id = a.id AND s.criterion_id = c.id
                  AND s.tenant_id = a.tenant_id
            WHERE a.tenant_id = $1 AND a.id = ANY($2::uuid[])
            ORDER BY c.block, c.sort_order, c.code`,
          [tenantId, rows.map((r) => r.id)],
        )
      : [];
    const byAssessment = new Map<string, Crit[]>();
    for (const c of crit) {
      const list = byAssessment.get(c.assessment_id) ?? [];
      list.push(c);
      byAssessment.set(c.assessment_id, list);
    }

    const school = await schoolValues(tenantId, manager);
    const out = new Map<string, ResolvedSubject>();
    for (const r of rows) {
      const list = byAssessment.get(r.id) ?? [];
      if (list.length > ACR_CRITERIA_SLOTS) {
        throw new ConflictException(
          `This ACR form has ${list.length} criteria; a template holds at most ${ACR_CRITERIA_SLOTS}`,
        );
      }
      const values: Record<string, string> = {
        ...blankValues(this.kind),
        ...school,
        'staff.name': r.full_name,
        'staff.name_bn': r.name_bn ?? '',
        'staff.designation': r.designation ?? '',
        'acr.year': r.year_name,
        'acr.total': r.total === null ? '' : String(r.total),
        'acr.completed_on': r.completed_on ?? '',
      };
      list.forEach((c, i) => {
        values[`acr.criterion.${i + 1}.label`] = c.label_en;
        values[`acr.criterion.${i + 1}.label_bn`] = c.label_bn;
        values[`acr.criterion.${i + 1}.score`] = c.score === null ? '' : String(c.score);
      });
      const out1: ResolvedSubject = {
        label: `${r.full_name} - ACR ${r.year_name}`,
        photoKey: null,
        values,
      };
      out.set(r.id, out1);
    }
    return out;
  }
}

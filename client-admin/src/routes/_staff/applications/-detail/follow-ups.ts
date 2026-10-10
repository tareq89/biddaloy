/** [52.5.2] Header actions an approved application hands on (D17 manual follow-up, D32 substitute). */
import type { ApplicationDto } from '@biddaloy/ui/hooks';
import type { PageAction } from '@biddaloy/ui/shells';

/** Already-translated labels, so this file needs no i18n of its own. */
export interface FollowUpLabels {
  print: (documentKind: string) => string;
  marks: string;
  substitute: string;
}

export interface FollowUpAllowed {
  print: boolean;
  marks: boolean;
  substitute: boolean;
}

const str = (v: unknown): string => (typeof v === 'string' ? v : '');
const qs = (params: Record<string, string>) => new URLSearchParams(params).toString();

export function followUpActions(
  app: Pick<ApplicationDto, 'id' | 'status' | 'effect_result'>,
  allowed: FollowUpAllowed,
  labels: FollowUpLabels,
): PageAction[] {
  const f = app.effect_result?.follow_up as Record<string, unknown> | undefined;
  if (app.status !== 'APPROVED' || !f) return [];

  if (f.kind === 'PRINT') {
    const ids = Array.isArray(f.subject_ids) ? f.subject_ids.map(str).join(',') : '';
    return [
      {
        id: 'follow-up-print',
        label: labels.print(str(f.document_kind)),
        allowed: allowed.print,
        priority: 'primary',
        to: `/print/preview?${qs({
          kind: str(f.document_kind),
          subject_type: str(f.subject_type),
          ids,
          from: `/applications/${app.id}`,
        })}`,
      },
    ];
  }
  if (f.kind === 'MARKS') {
    return [
      {
        id: 'follow-up-marks',
        label: labels.marks,
        allowed: allowed.marks,
        priority: 'secondary',
        to: `/marks/${str(f.exam_id)}/${str(f.section_id)}/${str(f.subject_id)}`,
      },
    ];
  }
  if (f.kind === 'SUBSTITUTE') {
    return [
      {
        id: 'follow-up-substitute',
        label: labels.substitute,
        allowed: allowed.substitute,
        priority: 'secondary',
        to: `/routines/substitutions?${qs({
          from: str(f.from),
          to: str(f.to),
          covered_for_teacher_id: str(f.covered_for_teacher_id),
        })}`,
      },
    ];
  }
  return [];
}

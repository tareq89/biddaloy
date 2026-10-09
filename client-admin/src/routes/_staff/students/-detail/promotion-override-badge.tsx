import { StatusBadge } from '@biddaloy/ui/components';
import { useStudentPromotionOverrides } from '@biddaloy/ui/hooks';
import { useTranslation } from '@biddaloy/ui/i18n';

export interface PromotionOverrideBadgeProps {
  studentId: string;
}

/**
 * [26.5.2] Header badge for a student who was promoted, retained or
 * graduated by override (D12). Nothing renders when the student has no
 * override entries — most students never hit this path. When there are
 * several (multiple promotion cycles), the most recently committed one
 * is shown; `findStudentOverrides` doesn't guarantee order server-side,
 * so sort by `committed_at` here rather than trusting array order.
 */
export function PromotionOverrideBadge({ studentId }: PromotionOverrideBadgeProps) {
  const { t } = useTranslation('students');
  const { data } = useStudentPromotionOverrides(studentId);

  if (!data || data.length === 0) return null;

  const latest = [...data].sort((a, b) =>
    (b.committed_at ?? '').localeCompare(a.committed_at ?? ''),
  )[0];
  if (!latest) return null;

  // Short label only; the full sentence with note and approver lives in the Enrollment tab.
  return (
    <StatusBadge
      tone="warning"
      label={t(`detail.overrideBadge.${latest.final_outcome.toLowerCase()}`)}
    />
  );
}

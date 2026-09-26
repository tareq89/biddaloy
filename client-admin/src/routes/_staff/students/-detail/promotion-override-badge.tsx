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
  const { t } = useTranslation('promotions');
  const { data } = useStudentPromotionOverrides(studentId);

  if (!data || data.length === 0) return null;

  const latest = [...data].sort((a, b) =>
    (b.committed_at ?? '').localeCompare(a.committed_at ?? ''),
  )[0];
  if (!latest) return null;

  return (
    <span className="inline-flex items-center rounded-full bg-status-due-bg px-2 py-0.5 text-xs font-medium text-status-due-fg">
      {t(`badge.${latest.final_outcome.toLowerCase()}`, {
        year: latest.target_academic_year_name ?? '',
        note: latest.override_note ?? '',
        user: latest.overridden_by_name ?? '',
      })}
    </span>
  );
}

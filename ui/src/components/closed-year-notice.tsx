/**
 * [69.4.02] S5: tells a person why a page cannot change a closed academic year's data.
 *
 * Pages call `useIsYearClosed(yearId)` to turn their write controls off (with
 * `closedNotice.tooltip`'s sentence as the tooltip) and render `<ClosedYearNotice>` under
 * the `PageHeader`. Open year, unknown year or a year still loading: nothing is shown and
 * nothing is disabled, so the page behaves as before. The server has the final say (409
 * `ACADEMIC_YEAR_CLOSED`); this is only the early explanation.
 */
import { Link } from '@tanstack/react-router';

import { ApiError } from '../api';
import { useAcademicYear } from '../hooks/academic-years';
import { useTranslation } from '../i18n';

import { NoticeBar } from './notice-bar';

/** True only once the year has loaded and carries a `closed_at`. */
export function useIsYearClosed(academicYearId: string | undefined): boolean {
  const year = useAcademicYear(academicYearId);
  return year.data?.closed_at != null;
}

/** True for the server's 409 `ACADEMIC_YEAR_CLOSED`. Its `message` is the sentence to show next
 * to the control that failed (Rule 23: one sentence, no echo of what was sent). */
export function isYearClosedError(error: unknown): error is ApiError {
  return (
    error instanceof ApiError &&
    error.statusCode === 409 &&
    (error.details as { code?: string } | undefined)?.code === 'ACADEMIC_YEAR_CLOSED'
  );
}

export interface ClosedYearNoticeProps {
  academicYearId: string | undefined;
  className?: string;
}

export function ClosedYearNotice({ academicYearId, className }: ClosedYearNoticeProps) {
  const { t } = useTranslation('academicYears');
  const year = useAcademicYear(academicYearId);
  if (!year.data || year.data.closed_at == null) return null;
  return (
    <NoticeBar
      tone="info"
      {...(className ? { className } : {})}
      action={
        <Link
          to={`/academic-years/${year.data.id}`}
          className="font-medium underline underline-offset-2"
        >
          {t('closedNotice.link')}
        </Link>
      }
    >
      {t('closedNotice.text', { name: year.data.name })}
    </NoticeBar>
  );
}

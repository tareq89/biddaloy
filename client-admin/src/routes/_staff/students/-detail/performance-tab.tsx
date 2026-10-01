/**
 * [28.4.5] Student detail's "Performance" tab — read-only rollup over
 * `GET /performance/students/:id` (D16/D18). Teachers/admins only: the tab is
 * mounted behind `MARK_VIEW` in `$studentId.tsx`, the same permission the
 * server gates the endpoint with. Phone: summary card, then swipeable
 * widgets (SwipeRow); desktop: grid. Bars are CSS only (D24).
 */
import { ApiError } from '@biddaloy/ui/api';
import { BarWidget, ErrorState, SummaryCard, SwipeRow, Skeleton } from '@biddaloy/ui/components';
import { useAcademicYears, useStudentPerformance } from '@biddaloy/ui/hooks';
import { useRegionConfig, useTranslation } from '@biddaloy/ui/i18n';
import { renderDigits } from '@biddaloy/ui/utils';

export interface PerformanceTabProps {
  studentId: string;
}

export function PerformanceTab({ studentId }: PerformanceTabProps) {
  const { t } = useTranslation('performance');
  const years = useAcademicYears({ limit: 100 });

  if (years.isPending) return <PerformanceSkeleton label={t('loading')} />;
  if (years.isError) return <PerformanceError onRetry={years.refetch} />;

  const current = years.data.data.find((y) => y.is_current) ?? years.data.data[0];
  if (!current) {
    return <p className="text-sm text-muted-foreground">{t('noYear')}</p>;
  }
  return <StudentPerformance studentId={studentId} academicYearId={current.id} />;
}

function StudentPerformance({
  studentId,
  academicYearId,
}: {
  studentId: string;
  academicYearId: string;
}) {
  const { t } = useTranslation('performance');
  const { numerals } = useRegionConfig();
  const query = useStudentPerformance(studentId, { academicYearId });

  if (query.isPending) return <PerformanceSkeleton label={t('loading')} />;
  // A 404 means no enrollment in the current year: same empty state as the staff tab.
  const notFound = query.error instanceof ApiError && query.error.statusCode === 404;
  if (query.isError && !notFound) return <PerformanceError onRetry={query.refetch} />;

  const d = query.data ?? EMPTY;
  const n = (value: string) => renderDigits(value, numerals);
  const pct = (v: number | null) => (v === null ? t('notAvailable') : n(`${Math.round(v)}%`));
  const num = (v: number | null) =>
    v === null ? t('notAvailable') : n(String(Math.round(v * 10) / 10));

  const examMax = Math.max(1, ...d.exams.map((e) => e.totalMarks));
  const hasHomework = d.homework.totalAssignments > 0;

  return (
    <div className="flex flex-col gap-3">
      <SummaryCard
        title={t('title')}
        headline={d.passRate === null ? null : { label: t('passRate'), value: pct(d.passRate) }}
        emptyLabel={t('notEnoughData')}
        figures={[
          { label: t('averageMarks'), value: num(d.averageMarks) },
          { label: t('averageGpa'), value: num(d.averageGpa) },
          { label: t('attendance'), value: pct(d.attendancePercent) },
        ]}
      />
      <SwipeRow label={t('title')}>
        <BarWidget
          title={t('examResults')}
          max={examMax}
          emptyLabel={t('notEnoughData')}
          bars={d.exams.map((e) => ({
            label: `${e.examName} (${e.grade})`,
            value: e.totalMarks,
            valueLabel: n(String(e.totalMarks)),
          }))}
        />
        <BarWidget
          title={t('attendanceTitle')}
          emptyLabel={t('notEnoughData')}
          bars={
            d.attendancePercent === null
              ? []
              : [
                  {
                    label: t('attendance'),
                    value: d.attendancePercent,
                    valueLabel: pct(d.attendancePercent),
                  },
                ]
          }
        />
        <BarWidget
          title={t('homeworkTitle')}
          emptyLabel={t('notEnoughData')}
          bars={
            hasHomework
              ? [
                  {
                    label: t('homeworkAllTime'),
                    value: d.homework.completionPercent,
                    valueLabel: pct(d.homework.completionPercent),
                  },
                ]
              : []
          }
        />
        <BarWidget
          title={t('noteRating')}
          max={5}
          emptyLabel={t('notEnoughData')}
          bars={
            d.noteRatingAverage === null
              ? []
              : [
                  {
                    label: t('noteRating'),
                    value: d.noteRatingAverage,
                    valueLabel: n(`${Math.round(d.noteRatingAverage * 10) / 10} / 5`),
                  },
                ]
          }
        />
      </SwipeRow>
    </div>
  );
}

const EMPTY = {
  passRate: null,
  averageMarks: null,
  averageGpa: null,
  attendancePercent: null,
  noteRatingAverage: null,
  exams: [],
  homework: { totalAssignments: 0, completed: 0, defaulters: 0, completionPercent: 0 },
};

function PerformanceSkeleton({ label }: { label: string }) {
  return (
    <div className="flex flex-col gap-3" aria-busy="true" aria-live="polite">
      <span className="sr-only">{label}</span>
      <Skeleton className="h-28 w-full rounded-lg" />
      <Skeleton className="h-40 w-full rounded-lg" />
    </div>
  );
}

function PerformanceError({ onRetry }: { onRetry: () => unknown }) {
  const { t } = useTranslation('performance');
  const { t: tCommon } = useTranslation('common');
  return (
    <ErrorState
      message={t('loadError')}
      retryLabel={tCommon('actions.retry')}
      onRetry={() => void onRetry()}
    />
  );
}

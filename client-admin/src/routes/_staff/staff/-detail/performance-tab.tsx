/**
 * [28.4.6] Staff detail's "Performance" tab — read-only rollup over
 * `GET /performance/staff/:userId` (D18/D19). Mounted behind `ACR_READ` in
 * `$userId.tsx`. Scope is the whole current academic year (no term filter UI).
 * A 404 (e.g. the ACR subject viewing themselves) renders every widget empty.
 * Survey results are sealed server-side: `averageStars === null` shows the
 * waiting message, never a number. Bars are CSS only (D24).
 */
import { ApiError } from '@biddaloy/ui/api';
import { BarWidget, ErrorState, SummaryCard, SwipeRow, Skeleton } from '@biddaloy/ui/components';
import { useAcademicYears, useStaffPerformance } from '@biddaloy/ui/hooks';
import { useRegionConfig, useTranslation } from '@biddaloy/ui/i18n';
import { renderDigits } from '@biddaloy/ui/utils';

export interface PerformanceTabProps {
  userId: string;
}

export function PerformanceTab({ userId }: PerformanceTabProps) {
  const { t } = useTranslation('performance');
  const years = useAcademicYears({ limit: 100 });

  if (years.isPending) return <PerformanceSkeleton label={t('loading')} />;
  if (years.isError) return <PerformanceError onRetry={years.refetch} />;

  const current = years.data.data.find((y) => y.is_current) ?? years.data.data[0];
  if (!current) {
    return <p className="text-sm text-muted-foreground">{t('noYear')}</p>;
  }
  return (
    <StaffPerformance
      userId={userId}
      academicYearId={current.id}
      yearNames={new Map(years.data.data.map((y) => [y.id, y.name]))}
    />
  );
}

const avg = (xs: (number | null)[]) => {
  const v = xs.filter((x): x is number => x !== null);
  return v.length === 0 ? null : v.reduce((a, b) => a + b, 0) / v.length;
};

function StaffPerformance({
  userId,
  academicYearId,
  yearNames,
}: {
  userId: string;
  academicYearId: string;
  yearNames: Map<string, string>;
}) {
  const { t } = useTranslation('performance');
  const { t: tEval } = useTranslation('evaluations');
  const { numerals } = useRegionConfig();
  const query = useStaffPerformance(userId, { academicYearId });

  if (query.isPending) return <PerformanceSkeleton label={t('loading')} />;
  const notFound = query.error instanceof ApiError && query.error.statusCode === 404;
  if (query.isError && !notFound) return <PerformanceError onRetry={query.refetch} />;

  const d = query.data;
  const n = (value: string) => renderDigits(value, numerals);
  const pct = (v: number | null) => (v === null ? t('notAvailable') : n(`${Math.round(v)}%`));
  const num = (v: number | null) =>
    v === null ? t('notAvailable') : n(String(Math.round(v * 10) / 10));

  const classes = d?.classes ?? [];
  const passRate = avg(classes.map((c) => c.passRate));
  const averageMarks = avg(classes.map((c) => c.averageMarks));
  const attendance = avg(classes.map((c) => c.attendancePercent));
  const hwTotal = classes.reduce((s, c) => s + c.homework.totalAssignments, 0);
  const hwDone = classes.reduce((s, c) => s + c.homework.completed, 0);
  const homework = hwTotal > 0 ? (hwDone / hwTotal) * 100 : null;
  const stars = d?.survey.averageStars ?? null;

  const one = (label: string, v: number | null, valueLabel: string, max = 100) => ({
    max,
    bars: v === null ? [] : [{ label, value: v, valueLabel }],
  });

  return (
    <div className="flex flex-col gap-3">
      <SummaryCard
        title={t('title')}
        headline={passRate === null ? null : { label: t('passRate'), value: pct(passRate) }}
        emptyLabel={t('notEnoughData')}
        figures={[
          { label: t('averageMarks'), value: num(averageMarks) },
          { label: t('attendance'), value: pct(attendance) },
          { label: t('incidents'), value: d ? n(String(d.incidentCount)) : t('notAvailable') },
        ]}
      />
      <SwipeRow label={t('title')}>
        <BarWidget
          title={t('acrByYear')}
          emptyLabel={t('notEnoughData')}
          max={Math.max(1, ...(d?.acr ?? []).map((a) => a.total ?? 0))}
          bars={(d?.acr ?? [])
            .filter((a) => a.total !== null)
            .map((a) => ({
              label: `${yearNames.get(a.academicYearId) ?? a.academicYearId} (${tEval(`acr.status.${a.status}`)})`,
              value: a.total ?? 0,
              valueLabel: n(String(a.total)),
            }))}
        />
        <BarWidget
          title={t('surveyAverage')}
          emptyLabel={t('surveyWaiting')}
          {...one(t('surveyAverage'), stars, n(`${Math.round((stars ?? 0) * 10) / 10} / 5`), 5)}
        />
        <BarWidget
          title={t('passRate')}
          emptyLabel={t('notEnoughData')}
          {...one(t('passRate'), passRate, pct(passRate))}
        />
        <BarWidget
          title={t('averageMarks')}
          emptyLabel={t('notEnoughData')}
          {...one(t('averageMarks'), averageMarks, num(averageMarks))}
        />
        <BarWidget
          title={t('attendanceTitle')}
          emptyLabel={t('notEnoughData')}
          {...one(t('attendance'), attendance, pct(attendance))}
        />
        <BarWidget
          title={t('homeworkTitle')}
          emptyLabel={t('notEnoughData')}
          {...one(t('homeworkAllTime'), homework, pct(homework))}
        />
      </SwipeRow>
    </div>
  );
}

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

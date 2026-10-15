/**
 * [8.10.7.5.08] Portal overview card: the picked child's newest published
 * result (`GET /students/:id/results` returns published exams only, newest
 * first, for a family caller). `LatestResultCardView` is presentational
 * (stories render it); `LatestResultCard` owns the query and mounts both
 * phone and desktop renderings.
 */
import { Meter, WidgetCard } from '@biddaloy/ui/components';
import { useStudentResults } from '@biddaloy/ui/hooks';
import { useRegionConfig, useTranslation } from '@biddaloy/ui/i18n';
import { formatNumber, formatScore } from '@biddaloy/ui/utils';
import { Link } from '@tanstack/react-router';

/** Highest GPA on the grading scale the meter is drawn against. */
const GPA_MAX = 5;

export interface LatestResult {
  examName: string;
  gpa: number;
  isFail: boolean;
  /** GPA of the next-older published exam, if any. */
  previousGpa: number | null;
}

export interface LatestResultCardViewProps {
  variant: 'full' | 'compact';
  childId: string;
  childName: string;
  result: LatestResult | null;
  loading?: boolean;
  failed?: boolean;
  onRetry?: () => void;
}

export function LatestResultCardView({
  variant,
  childId,
  childName,
  result,
  loading = false,
  failed = false,
  onRetry,
}: LatestResultCardViewProps) {
  const { t } = useTranslation('portal');
  const config = useRegionConfig();

  let trend: string | null = null;
  if (result?.isFail) trend = t('latestResult.failed');
  else if (result && result.previousGpa !== null) {
    const previous = formatScore(result.previousGpa, config);
    trend =
      result.gpa > result.previousGpa
        ? t('latestResult.better', { previous })
        : result.gpa < result.previousGpa
          ? t('latestResult.worse', { previous })
          : t('latestResult.same');
  }
  const gpaText = result ? t('latestResult.gpa', { gpa: formatScore(result.gpa, config) }) : '';
  const max = formatNumber(GPA_MAX, config);

  return (
    <WidgetCard
      title={t('latestResult.title')}
      variant={variant}
      loading={loading}
      loadingLabel={t('latestResult.title')}
      {...(failed && onRetry
        ? { error: { message: t('error.message'), retryLabel: t('error.retry'), onRetry } }
        : {})}
      {...(!result ? { empty: { reason: t('latestResult.emptyReason') } } : {})}
      {...(result
        ? {
            value: gpaText,
            summary:
              variant === 'compact' && trend
                ? trend
                : t('latestResult.examLine', { child: childName, exam: result.examName }),
          }
        : {})}
      {...(result && variant === 'full' ? { unit: t('latestResult.outOf', { max }) } : {})}
      {...(result
        ? {
            footer: (
              <Link
                to="/portal/results"
                search={{ student: childId }}
                className="text-primary underline"
              >
                {t('latestResult.link')}
              </Link>
            ),
          }
        : {})}
    >
      {result ? (
        <div className="flex flex-col gap-2">
          <Meter
            label={t('latestResult.meterLabel', { max })}
            value={result.gpa}
            max={GPA_MAX}
            valueText={gpaText}
          />
          {trend ? <p className="text-text-secondary">{trend}</p> : null}
        </div>
      ) : null}
    </WidgetCard>
  );
}

export function LatestResultCard({ childId, childName }: { childId: string; childName: string }) {
  const query = useStudentResults(childId);
  const [newest, older] = query.data ?? [];
  const props = {
    childId,
    childName,
    result: newest
      ? {
          examName: newest.exam_name,
          gpa: newest.gpa,
          isFail: newest.is_fail,
          previousGpa: older?.gpa ?? null,
        }
      : null,
    loading: query.isPending,
    failed: query.isError,
    onRetry: () => void query.refetch(),
  };
  return (
    <>
      <div className="hidden h-full md:block">
        <LatestResultCardView variant="full" {...props} />
      </div>
      <div className="md:hidden">
        <LatestResultCardView variant="compact" {...props} />
      </div>
    </>
  );
}

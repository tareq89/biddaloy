/**
 * [28.4.2] Per teacher-subject results. The server seals a pair until the
 * survey is CLOSED and `minResponses` answers exist (`hidden: true`, only a
 * count) — this view passes that through: it never shows more than it is given
 * and never invents an average.
 */
import { ErrorState, Skeleton, StatusBadge } from '@biddaloy/ui/components';
import { useSurveyResults, type SurveyStatus } from '@biddaloy/ui/hooks';
import { useTenantRegionConfig, useTranslation } from '@biddaloy/ui/i18n';
import { formatNumber } from '@biddaloy/ui/utils';

import { useSurveyNames } from './use-survey-names';

export function SurveyResults({ surveyId, status }: { surveyId: string; status: SurveyStatus }) {
  const { t } = useTranslation('evaluations');
  const cfg = useTenantRegionConfig();
  const query = useSurveyResults(surveyId);
  const { teacherName, subjectName } = useSurveyNames();

  if (query.isError) {
    return (
      <ErrorState
        message={t('surveys.detail.resultsLoadError')}
        onRetry={() => void query.refetch()}
      />
    );
  }
  if (!query.data) return <Skeleton className="h-40 w-full" />;
  const { minResponses, results } = query.data;

  return (
    <section aria-labelledby="survey-results-heading" className="space-y-4">
      <div>
        <h2 id="survey-results-heading" className="text-h2">
          {t('surveys.detail.resultsTitle')}
        </h2>
        <p className="mt-0.5 text-text-secondary">
          {t('surveys.detail.resultsSubtitle', { count: formatNumber(results.length, cfg) })}
        </p>
      </div>
      {status === 'OPEN' && results.length === 0 && (
        <p className="text-text-secondary">{t('surveys.detail.sealedOpen')}</p>
      )}
      <ul className="grid gap-4 md:grid-cols-2">
        {results.map((pair) => (
          <li
            key={`${pair.teacherId}:${pair.subjectId}`}
            className="rounded-lg border border-border-subtle bg-surface p-4 shadow-e1 md:p-5"
          >
            <div className="flex items-start justify-between gap-4">
              <div>
                <h3 className="text-h3">{teacherName(pair.teacherId)}</h3>
                <p className="text-text-secondary">
                  {subjectName(pair.subjectId)} ·{' '}
                  {t('surveys.detail.responses', { count: formatNumber(pair.count, cfg) })}
                </p>
              </div>
              {pair.hidden && (
                <StatusBadge tone="warning" label={t('surveys.detail.waitingBadge')} />
              )}
            </div>
            {pair.hidden ? (
              <p role="status" className="mt-3 text-text-secondary">
                {t('surveys.detail.waiting', {
                  count: formatNumber(pair.count, cfg),
                  min: formatNumber(minResponses, cfg),
                })}{' '}
                {t('surveys.detail.waitingWhy')}
              </p>
            ) : (
              <ul className="mt-3 divide-y divide-border-subtle">
                {pair.questions.map((q) => (
                  <li key={q.questionId} className="py-3 last:pb-0">
                    <div className="flex items-start justify-between gap-4">
                      <p className="font-medium">{q.text}</p>
                      <p
                        className={`shrink-0 tabular-nums ${q.averageStars === null ? 'text-text-secondary' : ''}`}
                      >
                        {q.averageStars === null
                          ? t('surveys.detail.noStarsShort')
                          : t('surveys.detail.averageStars', {
                              value: formatNumber(q.averageStars, cfg, { decimals: 1 }),
                            })}
                      </p>
                    </div>
                    {q.comments.length === 0 ? (
                      <p className="mt-2 text-text-secondary">{t('surveys.detail.noComments')}</p>
                    ) : (
                      <ul
                        aria-label={t('surveys.detail.comments')}
                        className="mt-2 space-y-1 text-text-secondary"
                      >
                        {q.comments.map((c, i) => (
                          <li key={i} className="border-s-2 border-border-subtle ps-3">
                            {c}
                          </li>
                        ))}
                      </ul>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}

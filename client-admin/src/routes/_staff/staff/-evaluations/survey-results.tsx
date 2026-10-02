/**
 * [28.4.2] Per teacher-subject results. The server seals a pair until the
 * survey is CLOSED and `minResponses` answers exist (`hidden: true`, only a
 * count) — this view passes that through: it never shows more than it is given
 * and never invents an average.
 */
import { Card, ErrorState, Skeleton } from '@biddaloy/ui/components';
import { useSurveyResults, type SurveyStatus } from '@biddaloy/ui/hooks';
import { useTranslation } from '@biddaloy/ui/i18n';

import { useSurveyNames } from './use-survey-names';

export function SurveyResults({ surveyId, status }: { surveyId: string; status: SurveyStatus }) {
  const { t } = useTranslation('evaluations');
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
    <section aria-labelledby="survey-results-heading" className="flex flex-col gap-4">
      <h2 id="survey-results-heading" className="text-lg font-semibold">
        {t('surveys.detail.resultsTitle')}
      </h2>
      {status === 'OPEN' && (
        <p className="text-sm text-muted-foreground">{t('surveys.detail.sealedOpen')}</p>
      )}
      <ul className="flex flex-col gap-3 sm:grid sm:grid-cols-2">
        {results.map((pair) => (
          <li key={`${pair.teacherId}:${pair.subjectId}`}>
            <Card className="flex flex-col gap-3 p-4">
              <div>
                <h3 className="font-medium">{teacherName(pair.teacherId)}</h3>
                <p className="text-sm text-muted-foreground">
                  {subjectName(pair.subjectId)} ·{' '}
                  {t('surveys.detail.responses', { count: pair.count })}
                </p>
              </div>
              {pair.hidden ? (
                <p role="status" className="text-sm">
                  {t('surveys.detail.waiting', { count: pair.count, min: minResponses })}
                </p>
              ) : (
                pair.questions.map((q) => (
                  <div key={q.questionId} className="flex flex-col gap-1">
                    <p className="text-sm font-medium">{q.text}</p>
                    <p className="text-sm">
                      {q.averageStars === null
                        ? t('surveys.detail.noStars')
                        : t('surveys.detail.averageStars', { value: q.averageStars })}
                    </p>
                    {q.comments.length === 0 ? (
                      <p className="text-sm text-muted-foreground">
                        {t('surveys.detail.noComments')}
                      </p>
                    ) : (
                      <ul
                        aria-label={t('surveys.detail.comments')}
                        className="list-disc ps-5 text-sm"
                      >
                        {q.comments.map((c, i) => (
                          <li key={i}>{c}</li>
                        ))}
                      </ul>
                    )}
                  </div>
                ))
              )}
            </Card>
          </li>
        ))}
      </ul>
    </section>
  );
}

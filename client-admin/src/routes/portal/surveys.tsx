/**
 * [28.4.3] Portal › Surveys — a student or guardian answers every question for
 * each of their teachers. Layout cloned from `portal/results.tsx`: same
 * loading / empty / error frames and the same "no `<h1>` while pending or
 * erroring" heading contract (`useRouteFocus` falls back to `<main>`).
 *
 * `GET /surveys/mine` carries the teacher and subject display names (PARENT/
 * STUDENT get 403 on `/teachers` and `/subjects`), so a pair is labelled
 * with the teacher name over the subject, using the Bangla subject name when
 * the UI is in bn.
 *
 * Privacy line (D10) is driven by the survey's `anonymous` flag and says
 * "hidden from management" / "your name will be shown". It never claims
 * answers are untraceable.
 *
 * Stars are optional: tap, or focus the group and press 1 to 5 (Backspace
 * clears). One submit per teacher; a 409 (already answered) is shown as such.
 */
import { ApiError } from '@biddaloy/ui/api';
import {
  Button,
  Card,
  EmptyState,
  ErrorState,
  Skeleton,
  Textarea,
  toast,
} from '@biddaloy/ui/components';
import { useMySurveys, useRespondSurvey, type PendingSurvey } from '@biddaloy/ui/hooks';
import { RegionConfigProvider, useRegionConfig, useTranslation } from '@biddaloy/ui/i18n';
import { PageContainer, PageHeader } from '@biddaloy/ui/shells';
import { formatDate } from '@biddaloy/ui/utils';
import { createFileRoute } from '@tanstack/react-router';
import {
  CalendarClockIcon,
  ChevronDownIcon,
  CircleAlertIcon,
  ClipboardCheckIcon,
  EyeOffIcon,
  SendIcon,
  StarIcon,
  UserRoundIcon,
} from 'lucide-react';
import * as React from 'react';

import { loadRouteNamespaces } from '../../route-loaders';

export const Route = createFileRoute('/portal/surveys')({
  loader: () => loadRouteNamespaces('evaluations', 'portal', 'common'),
  pendingComponent: SurveysPending,
  component: PortalSurveysRoute,
});

function PortalSurveysRoute() {
  // Value-less provider, same reasoning as `portal/index.tsx`.
  return (
    <RegionConfigProvider>
      <PortalSurveys />
    </RegionConfigProvider>
  );
}

function PortalSurveys() {
  const { t, i18n } = useTranslation('evaluations');
  const { t: tPortal } = useTranslation('portal');
  const config = useRegionConfig();
  const bn = i18n.language === 'bn';
  const query = useMySurveys();

  if (query.isPending) return <SurveysSkeleton label={t('portalSurveys.loading')} />;
  if (query.isError) {
    return (
      <ErrorState message={t('portalSurveys.loadError')} onRetry={() => void query.refetch()} />
    );
  }
  if (query.data.length === 0) {
    return (
      <PageContainer size="narrow">
        <PageHeader title={t('portalSurveys.title')} subtitle={tPortal('surveys.subtitle')} />
        <EmptyState
          icon={<ClipboardCheckIcon />}
          title={t('portalSurveys.empty')}
          explanation={t('portalSurveys.emptyBody')}
        />
      </PageContainer>
    );
  }

  return (
    <PageContainer size="narrow">
      <PageHeader title={t('portalSurveys.title')} subtitle={tPortal('surveys.subtitle')} />
      {query.data.map((survey) => {
        const titleId = `survey-${survey.id}`;
        return (
          <Card key={survey.id} asChild padded>
            <article aria-labelledby={titleId}>
              <h2 id={titleId} className="text-h2">
                {survey.title}
              </h2>
              <ul className="mt-2 space-y-1 text-text-secondary">
                <li className="flex items-start gap-2">
                  {survey.anonymous ? (
                    <EyeOffIcon className="mt-1 size-4 shrink-0" aria-hidden="true" />
                  ) : (
                    <UserRoundIcon className="mt-1 size-4 shrink-0" aria-hidden="true" />
                  )}
                  {t(survey.anonymous ? 'portalSurveys.anonymousNote' : 'portalSurveys.namedNote')}
                </li>
                {survey.closesAt && (
                  <li className="flex items-start gap-2">
                    <CalendarClockIcon className="mt-1 size-4 shrink-0" aria-hidden="true" />
                    {t('portalSurveys.closesOn', {
                      date: formatDate(new Date(survey.closesAt), config),
                    })}
                  </li>
                )}
              </ul>
              <p className="mt-4 text-label text-text-secondary">
                {tPortal('surveys.pendingCount', { count: survey.pending.length })}
              </p>
              <div className="mt-2 divide-y divide-border-subtle rounded-md border border-border-subtle">
                {survey.pending.map((pair) => (
                  <PairForm
                    key={`${pair.teacherId}:${pair.subjectId}`}
                    survey={survey}
                    pair={pair}
                    teacherName={pair.teacherName}
                    subjectLabel={(bn && pair.subjectNameBn) || pair.subjectName}
                  />
                ))}
              </div>
            </article>
          </Card>
        );
      })}
    </PageContainer>
  );
}

type Pair = PendingSurvey['pending'][number];

function PairForm({
  survey,
  pair,
  teacherName,
  subjectLabel,
}: {
  survey: PendingSurvey;
  pair: Pair;
  teacherName: string;
  subjectLabel: string;
}) {
  const { t } = useTranslation('evaluations');
  const { t: tPortal } = useTranslation('portal');
  const respond = useRespondSurvey(survey.id);
  const [text, setText] = React.useState<Record<string, string>>({});
  const [stars, setStars] = React.useState<Record<string, number>>({});
  const [empty, setEmpty] = React.useState(false);
  const conflict = respond.error instanceof ApiError && respond.error.statusCode === 409;

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const answers = survey.questions
      .map((q) => {
        const answer: { questionId: string; text?: string; stars?: number } = { questionId: q.id };
        const typed = text[q.id]?.trim();
        if (typed) answer.text = typed;
        const rating = stars[q.id];
        if (q.starsEnabled && rating) answer.stars = rating;
        return answer;
      })
      .filter((a) => a.text !== undefined || a.stars !== undefined);
    setEmpty(answers.length === 0);
    if (answers.length === 0) return;
    respond.mutate(
      { teacherId: pair.teacherId, subjectId: pair.subjectId, answers },
      {
        onSuccess: () => toast.success(t('portalSurveys.sent')),
        // After a 409 the refetch drops this pair and unmounts the form, so the
        // inline message would vanish; say it in a toast too.
        onError: (err) => {
          if (err instanceof ApiError && err.statusCode === 409) {
            toast.info(t('portalSurveys.alreadyAnswered'));
          }
        },
      },
    );
  }

  const id = `${survey.id}-${pair.teacherId}-${pair.subjectId}`;
  return (
    <details className="group/pair">
      <summary className="flex min-h-14 cursor-pointer list-none items-center gap-3 px-3 py-2 hover:bg-muted">
        <span className="min-w-0 flex-1">
          <span className="block font-medium">{teacherName}</span>
          <span className="block text-caption text-text-secondary">{subjectLabel}</span>
        </span>
        <ChevronDownIcon
          className="size-4 shrink-0 text-text-secondary group-open/pair:rotate-180"
          aria-hidden="true"
        />
      </summary>
      <form
        noValidate
        onSubmit={submit}
        className="flex flex-col gap-4 border-t border-border-subtle p-3 md:p-4"
      >
        <p className="text-caption text-text-secondary">{tPortal('surveys.optionalHint')}</p>
        {survey.questions.map((q) => (
          <div key={q.id} className="flex flex-col gap-1.5">
            <label htmlFor={`${id}-${q.id}`} className="text-label text-text-primary">
              {q.text}
            </label>
            {q.starsEnabled && (
              <Stars
                label={`${t('portalSurveys.starsLabel')}: ${q.text}`}
                value={stars[q.id] ?? 0}
                onChange={(v) => setStars((s) => ({ ...s, [q.id]: v }))}
              />
            )}
            <Textarea
              id={`${id}-${q.id}`}
              rows={2}
              value={text[q.id] ?? ''}
              onChange={(e) => setText((s) => ({ ...s, [q.id]: e.target.value }))}
            />
          </div>
        ))}
        {empty && (
          <p role="alert" className="flex items-center gap-1 text-caption text-destructive">
            <CircleAlertIcon className="size-4 shrink-0" aria-hidden="true" />
            {t('portalSurveys.errorEmpty')}
          </p>
        )}
        {respond.isError && (
          <p role="alert" className="flex items-center gap-1 text-caption text-destructive">
            <CircleAlertIcon className="size-4 shrink-0" aria-hidden="true" />
            {t(conflict ? 'portalSurveys.alreadyAnswered' : 'portalSurveys.errorMessage')}
          </p>
        )}
        <div className="flex flex-col-reverse gap-2 border-t border-border-subtle pt-4 md:flex-row md:justify-end">
          <Button type="submit" className="w-full md:w-auto" loading={respond.isPending}>
            <SendIcon className="size-4" aria-hidden="true" />
            {respond.isPending ? t('portalSurveys.submitting') : t('portalSurveys.submit')}
          </Button>
        </div>
      </form>
    </details>
  );
}

/** Optional 1–5 rating: tap a star again to clear; with focus inside, keys 1–5 set and Backspace clears. */
function Stars({
  label,
  value,
  onChange,
}: {
  label: string;
  value: number;
  onChange: (value: number) => void;
}) {
  const { t } = useTranslation('evaluations');
  return (
    // eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions -- focus lives on the star buttons; keys bubble from them
    <div
      role="group"
      aria-label={label}
      className="flex items-center gap-1"
      onKeyDown={(e) => {
        if (/^[1-5]$/.test(e.key)) onChange(Number(e.key));
        else if (e.key === 'Backspace' || e.key === 'Delete') onChange(0);
        else return;
        e.preventDefault();
      }}
    >
      {[1, 2, 3, 4, 5].map((n) => (
        <button
          key={n}
          type="button"
          aria-pressed={value === n}
          aria-label={t('portalSurveys.starsValue', { count: n })}
          className={`flex size-11 items-center justify-center rounded-md hover:bg-muted ${
            n <= value ? 'text-status-due-fg' : 'text-text-secondary'
          }`}
          onClick={() => onChange(value === n ? 0 : n)}
        >
          <StarIcon aria-hidden="true" className={n <= value ? 'size-6 fill-current' : 'size-6'} />
        </button>
      ))}
      <span className="sr-only">{t('portalSurveys.starsHint')}</span>
    </div>
  );
}

function SurveysSkeleton({ label }: { label: string }) {
  return (
    <div role="status" aria-busy="true" aria-label={label} className="flex flex-col gap-3">
      <Skeleton className="h-9 w-32" />
      <Skeleton className="h-32 w-full rounded-lg" />
    </div>
  );
}

function SurveysPending() {
  const { t } = useTranslation('nav');
  return <SurveysSkeleton label={t('routePending.label', { ns: 'nav' })} />;
}

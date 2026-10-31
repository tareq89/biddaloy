/**
 * [8.15.29] `/reports/$reportId` — open a defined report and see the answer.
 *
 * ```
 *  Student list                                   (title = the report's name)
 *  [ ২০২৬ · সব শ্রেণি · সব শাখা · বদলান ]  [Print] [Download to Excel · 154 ][v]
 *
 *  Class   | Boys | Girls | Total          <- the result, by the report's layout
 *  ...
 *  Was this report useful?  [👍] [👎]       <- once per report, never blocks the result
 * ```
 *
 * Opening the page runs the report at once with its default answers (D22): the first thing a person
 * sees is the answer, not a form. The questions the report asks sit above the result as one line
 * (`PromptSummary`); pressing it opens the full form (`ReportPrompts`), and Show report (or Enter)
 * runs again. The answers are kept in the address bar (`?p=`), so a link reopens the same view.
 *
 * Where the layout and the questions come from: the catalogue (`GET /reports/catalogue`) names the
 * report, but the definition itself (`GET /reports/definitions/:id`) is open only to someone who may
 * design reports. So a designer gets the report's own layout and questions; everyone else gets a
 * plain table, and the server still applies the report's default answers. A server follow-up would
 * let every viewer read the layout (see the 8.15.29 notes).
 *
 * Failures are said in place, in plain words: a report that is too slow asks the person to narrow
 * the choices (and opens the form), a missing answer says so, a report that is gone says so.
 *
 * Words come from `reports.json` `runner.*` and `prompts.*` (the 8.15 glossary).
 */
import { Permission, type ReportDefinitionJson, type ReportLayout } from '@biddaloy/shared';
import { ApiError } from '@biddaloy/ui/api';
import {
  Button,
  EmptyState,
  ErrorState,
  ExportMenu,
  PromptSummary,
  ReportChart,
  ReportCrosstab,
  ReportGrouped,
  ReportPrompts,
  ReportTable,
  RoutePending,
  Skeleton,
  Textarea,
  defaultPromptValues,
  missingPrompts,
  promptParams,
  sanitizePromptValues,
  toast,
  withDefaults,
  type PromptChoices,
  type PromptParameter,
  type PromptValues,
} from '@biddaloy/ui/components';
import {
  academicYearsQueryOptions,
  allClassesQueryOptions,
  classSectionsQueryOptions,
  reportCatalogueQueryOptions,
  reportErrorCode,
  useExportReport,
  useHasPermission,
  useReportCatalogue,
  useReportDefinition,
  useReportFeedback,
  useRunReport,
  type ReportRunResponse,
} from '@biddaloy/ui/hooks';
import {
  RegionConfigProvider,
  useLocale,
  useRegionConfig,
  useTenantRegionConfig,
  useTranslation,
} from '@biddaloy/ui/i18n';
import { PageContainer, PageHeader } from '@biddaloy/ui/shells';
import { formatNumber } from '@biddaloy/ui/utils';
import { useQueries, useQuery } from '@tanstack/react-query';
import { createFileRoute } from '@tanstack/react-router';
import { PrinterIcon, ThumbsDownIcon, ThumbsUpIcon } from 'lucide-react';
import * as React from 'react';
import { z } from 'zod';

import { loadRouteNamespaces, swallowUnlessOffline } from '../../../route-loaders';

const runnerSearchSchema = z.object({
  // The answers to the report's questions. Anything wrong in them is dropped when they are read.
  p: z.record(z.string(), z.unknown()).optional().catch(undefined),
});

export const Route = createFileRoute('/_staff/reports/$reportId')({
  validateSearch: runnerSearchSchema,
  loader: ({ context: { queryClient } }) =>
    Promise.all([
      queryClient.ensureQueryData(reportCatalogueQueryOptions()).catch(swallowUnlessOffline),
      loadRouteNamespaces('reports', 'reportView', 'common', 'nav'),
    ]),
  pendingComponent: ReportRunnerPending,
  component: ReportRunnerPage,
});

function ReportRunnerPending() {
  const { t } = useTranslation('reports');
  return <RoutePending variant="list" label={t('routePending.label', { ns: 'nav' })} />;
}

/** `/print/document?doc=report&definitionId=…&params=…`: the print page reads the answers from here. */
function printReportUrl(definitionId: string, params: object): string {
  const query = new URLSearchParams({
    doc: 'report',
    definitionId,
    params: JSON.stringify(params),
  });
  return `/print/document?${query.toString()}`;
}

function ReportRunnerPage() {
  // `useRegionConfig()` has no ambient provider above the route tree (see `attendance/reports.tsx`).
  const regionConfig = useTenantRegionConfig();
  const { reportId } = Route.useParams();
  return (
    <RegionConfigProvider value={regionConfig}>
      {/* Keyed, so opening another report starts clean instead of reusing this one's answers. */}
      <ReportRunner key={reportId} reportId={reportId} />
    </RegionConfigProvider>
  );
}

function ReportRunner({ reportId }: { reportId: string }) {
  const { t } = useTranslation('reports');
  const { locale } = useLocale();
  const regionConfig = useRegionConfig();
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  const canDesign = useHasPermission(Permission.REPORTS_DESIGN);
  const canExport = useHasPermission(Permission.REPORTS_EXPORT);
  const canPrint = useHasPermission(Permission.DOCUMENT_PRINT);
  const canReadStructure = useHasPermission(Permission.ACADEMIC_STRUCTURE_READ);

  const catalogue = useReportCatalogue();
  const entry = catalogue.data?.flatMap((folder) => folder.reports).find((r) => r.id === reportId);
  const name = entry ? (locale === 'bn' ? entry.name_bn : entry.name_en) || entry.name_en : '';

  // The layout and the questions: only a designer may read the definition (see the file header).
  const definition = useReportDefinition(reportId, { enabled: canDesign && entry !== undefined });
  const body = (definition.data?.draft ?? null) as ReportDefinitionJson | null;
  const parameters: PromptParameter[] = body?.parameters ?? [];
  const layout: ReportLayout | undefined = body?.layout;

  // Choices for the questions. A role that cannot read the school's structure sees none, and then
  // the report simply runs on the server's own default answers.
  const needsYears = parameters.some((p) => p.type === 'ACADEMIC_YEAR');
  const needsClasses = parameters.some((p) => p.type === 'CLASS' || p.type === 'SECTION');
  const needsSections = parameters.some((p) => p.type === 'SECTION');
  const years = useQuery({
    ...academicYearsQueryOptions({ limit: 100 }),
    enabled: needsYears && canReadStructure,
  });
  const classList = useQuery({
    ...allClassesQueryOptions(),
    enabled: needsClasses && canReadStructure,
  });
  const sectionLists = useQueries({
    queries: (classList.data ?? []).map((c) => ({
      ...classSectionsQueryOptions(c.id),
      enabled: needsSections && canReadStructure,
    })),
  });
  const sectionKey = sectionLists.map((q) => q.dataUpdatedAt).join(',');
  const choices = React.useMemo<PromptChoices>(() => {
    const classes = [...new Set((classList.data ?? []).map((c) => c.name))].map((n) => ({
      name: n,
    }));
    const seen = new Set<string>();
    const sections: PromptChoices['sections'] = [];
    for (const list of sectionLists) {
      for (const section of list.data ?? []) {
        const key = `${section.class?.name ?? ''}\u0000${section.section_name}`;
        if (seen.has(key)) continue;
        seen.add(key);
        sections.push({ name: section.section_name, className: section.class?.name ?? '' });
      }
    }
    return {
      classes,
      sections,
      academicYears: (years.data?.data ?? []).map((y) => ({
        name: y.name,
        isCurrent: y.is_current,
      })),
    };
    // `sectionLists` is a new array every render; `sectionKey` says when its data really changed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [classList.data, years.data, sectionKey]);

  const run = useRunReport();
  const exportReport = useExportReport();
  const [values, setValues] = React.useState<PromptValues | null>(null);
  // The answers the shown result was run with: what Print and the download use, not unsent edits.
  const [ran, setRan] = React.useState<PromptValues | null>(null);
  const [promptsOpen, setPromptsOpen] = React.useState(false);
  const [page, setPage] = React.useState(1);

  function execute(answers: PromptValues, nextPage = 1) {
    setRan(answers);
    setPage(nextPage);
    run.mutate({
      definitionId: reportId,
      params: promptParams(parameters, answers),
      page: nextPage,
    });
  }

  // Run once, as soon as everything the first run needs has settled (D22). A ref, not state, so
  // React's double effect in development and a remount never write two run-log rows.
  const started = React.useRef(false);
  const definitionSettled = entry !== undefined && (!canDesign || !definition.isPending);
  const yearsSettled = !(needsYears && canReadStructure) || !years.isPending;
  React.useEffect(() => {
    if (started.current || !definitionSettled || !yearsSettled) return;
    started.current = true;
    const initial = withDefaults(parameters, sanitizePromptValues(search.p, parameters), choices);
    setValues(initial);
    // A question with no answer and a way to answer it waits for the person; with no way to
    // answer it (a role that cannot read the classes), the server's own defaults apply.
    if (missingPrompts(parameters, initial).length > 0 && canReadStructure) {
      setPromptsOpen(true);
      return;
    }
    execute(initial);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [definitionSettled, yearsSettled]);

  // A report that is too slow, or that still lacks an answer, is fixed in the form: open it.
  const errorCode = reportErrorCode(run.error);
  React.useEffect(() => {
    if (errorCode === 'REPORT_TOO_SLOW' || errorCode === 'MISSING_PARAM') setPromptsOpen(true);
  }, [errorCode]);

  function onPromptsRun() {
    const answers = values ?? defaultPromptValues(parameters, choices);
    setPromptsOpen(false);
    const params = promptParams(parameters, answers);
    void navigate({
      search: { p: Object.keys(params).length > 0 ? params : undefined },
      replace: true,
    });
    execute(answers);
  }

  const result: ReportRunResponse | undefined = run.data;
  const ranParams = promptParams(parameters, ran ?? {});
  const notFound =
    (catalogue.isSuccess && entry === undefined) ||
    (run.error instanceof ApiError && run.error.statusCode === 404);
  const formatCount = (n: number) => formatNumber(n, regionConfig);

  if (catalogue.isPending) {
    return (
      <PageContainer>
        <div className="flex flex-col gap-4" aria-hidden="true">
          <Skeleton className="h-8 w-64" />
          <Skeleton className="h-11 w-full" />
          <Skeleton className="h-48 w-full" />
        </div>
      </PageContainer>
    );
  }

  if (notFound) {
    return (
      <PageContainer>
        <EmptyState
          headingLevel={1}
          title={t('runner.notFound.title')}
          explanation={t('runner.notFound.explanation')}
          action={{
            label: t('runner.notFound.back'),
            onClick: () => void navigate({ to: '/reports' }),
          }}
        />
      </PageContainer>
    );
  }

  function errorMessage(): string {
    if (errorCode === 'REPORT_TOO_SLOW') return t('runner.errors.slow');
    if (errorCode === 'MISSING_PARAM') return t('runner.errors.missing');
    if (errorCode === 'NOTHING_TO_SHOW') return t('runner.errors.nothing');
    return t('runner.errors.generic');
  }

  return (
    <PageContainer>
      <div className="flex flex-col gap-4 md:gap-6">
        <PageHeader title={name} />

        <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between print:hidden">
          {values !== null && parameters.length > 0 ? (
            <div className="min-w-0 flex-1">
              <PromptSummary
                parameters={parameters}
                value={values}
                expanded={promptsOpen}
                onToggle={() => setPromptsOpen((open) => !open)}
              />
            </div>
          ) : (
            <div className="flex-1" />
          )}
          <div className="flex flex-wrap items-start gap-2">
            {canPrint && (
              <Button
                type="button"
                variant="outline"
                disabled={result === undefined}
                onClick={() =>
                  window.open(printReportUrl(reportId, ranParams), '_blank', 'noopener')
                }
              >
                <PrinterIcon aria-hidden="true" />
                {t('runner.print')}
              </Button>
            )}
            <ExportMenu
              totalCount={result?.total_rows ?? 0}
              canExportAll={canExport && result !== undefined}
              unit="items"
              onExportAll={async (format) => {
                const outcome = await exportReport.mutateAsync({
                  definitionId: reportId,
                  params: ranParams,
                  format,
                });
                // A large file is prepared in the background; the bell says when it is ready.
                if (outcome.kind === 'queued') toast.info(t('runner.exportQueued'));
              }}
            />
          </div>
        </div>

        {values !== null && parameters.length > 0 && (
          <div className="print:hidden">
            <ReportPrompts
              parameters={parameters}
              value={values}
              onChange={setValues}
              onRun={onPromptsRun}
              choices={choices}
              running={run.isPending}
              open={promptsOpen}
              onOpenChange={setPromptsOpen}
            />
          </div>
        )}

        <section
          aria-label={t('runner.resultLabel')}
          aria-busy={run.isPending}
          className="flex flex-col gap-4"
        >
          {run.isError ? (
            <ErrorState
              message={errorMessage()}
              retryLabel={t('runner.retry')}
              onRetry={() => (ran ? execute(ran, page) : onPromptsRun())}
            />
          ) : result === undefined ? (
            <div className="flex flex-col gap-3" aria-hidden="true">
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
            </div>
          ) : result.rows.length === 0 ? (
            <EmptyState
              kind="no-results"
              title={t('runner.empty.title')}
              explanation={t('runner.empty.explanation')}
            />
          ) : (
            <>
              {result.truncated && (
                <p className="text-text-secondary">
                  {t('runner.truncated', { n: formatCount(result.total_rows) })}
                </p>
              )}
              <ResultView
                result={result}
                layout={layout}
                caption={name}
                loading={run.isPending}
                onPageChange={(next) => ran && execute(ran, next)}
              />
              <UsefulLine reportId={reportId} runId={result.run_id} />
            </>
          )}
        </section>
      </div>
    </PageContainer>
  );
}

/** The renderer the report's layout asks for; no layout (or a plain list) is a table. */
function ResultView({
  result,
  layout,
  caption,
  loading,
  onPageChange,
}: {
  result: ReportRunResponse;
  layout: ReportLayout | undefined;
  caption: string;
  loading: boolean;
  onPageChange: (page: number) => void;
}) {
  switch (layout?.type) {
    case 'GROUPED':
      return <ReportGrouped result={result} layout={layout} caption={caption} />;
    case 'CROSSTAB':
      return <ReportCrosstab result={result} layout={layout} caption={caption} />;
    case 'CHART':
      return <ReportChart result={result} layout={layout} caption={caption} />;
    default:
      return (
        <ReportTable
          result={result}
          caption={caption}
          tableId="report-run"
          isFetching={loading}
          {...(result.total_pages > 1 ? { onPageChange } : {})}
        />
      );
  }
}

const feedbackKey = (reportId: string) => `reports.feedback.${reportId}`;

function wasAnswered(reportId: string): boolean {
  try {
    return localStorage.getItem(feedbackKey(reportId)) !== null;
  } catch {
    return false;
  }
}

function rememberAnswer(reportId: string) {
  try {
    localStorage.setItem(feedbackKey(reportId), '1');
  } catch {
    // A blocked store: the question may come back on a later visit. That is all.
  }
}

/**
 * One quiet line under the result, the first time a person runs this report (D24). A thumb sends at
 * once; "no" opens one optional box ("What was missing?"). Never a modal, never blocks the result,
 * and once answered it is never asked again for this report.
 */
function UsefulLine({ reportId, runId }: { reportId: string; runId: string }) {
  const { t } = useTranslation('reports');
  const feedback = useReportFeedback();
  const [phase, setPhase] = React.useState<'ask' | 'comment' | 'thanks' | 'hidden'>(() =>
    wasAnswered(reportId) ? 'hidden' : 'ask',
  );
  const [comment, setComment] = React.useState('');
  const commentId = React.useId();

  function send(helpful: boolean) {
    // A 409 means this run was answered already: as good as sent.
    const done = () => {
      rememberAnswer(reportId);
      setPhase('thanks');
    };
    feedback.mutate(
      { runId, helpful, ...(helpful ? {} : { comment }) },
      {
        onSuccess: done,
        onError: (error) => {
          if (error instanceof ApiError && error.statusCode === 409) done();
        },
      },
    );
  }

  if (phase === 'hidden') return null;
  if (phase === 'thanks') {
    return (
      <p role="status" className="text-sm text-text-secondary print:hidden">
        {t('runner.feedback.thanks')}
      </p>
    );
  }
  return (
    <div className="flex flex-col gap-2 text-sm text-text-secondary print:hidden">
      <div className="flex flex-wrap items-center gap-1">
        <span>{t('runner.feedback.question')}</span>
        <Button
          type="button"
          variant="ghost"
          iconOnly
          className="size-11 md:size-8"
          aria-label={t('runner.feedback.yes')}
          disabled={feedback.isPending}
          onClick={() => send(true)}
        >
          <ThumbsUpIcon aria-hidden="true" />
        </Button>
        <Button
          type="button"
          variant="ghost"
          iconOnly
          className="size-11 md:size-8"
          aria-label={t('runner.feedback.no')}
          aria-expanded={phase === 'comment'}
          disabled={feedback.isPending}
          onClick={() => setPhase('comment')}
        >
          <ThumbsDownIcon aria-hidden="true" />
        </Button>
      </div>
      {phase === 'comment' && (
        <form
          className="flex w-full flex-col gap-2 md:w-96"
          onSubmit={(event) => {
            event.preventDefault();
            if (!feedback.isPending) send(false);
          }}
        >
          <label htmlFor={commentId} className="text-text-primary">
            {t('runner.feedback.missing')}
          </label>
          <Textarea
            id={commentId}
            value={comment}
            maxLength={500}
            onChange={(event) => setComment(event.target.value)}
          />
          <div>
            <Button type="submit" variant="outline" loading={feedback.isPending}>
              {t('runner.feedback.send')}
            </Button>
          </div>
        </form>
      )}
      {feedback.isError &&
        !(feedback.error instanceof ApiError && feedback.error.statusCode === 409) && (
          <p role="alert" className="text-destructive">
            {t('runner.feedback.error')}
          </p>
        )}
    </div>
  );
}

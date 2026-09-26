/**
 * [26.5.1] Exams & Results › Analysis — merit list, defaulters, pass/fail
 * (plus per-component), all URL-driven (exam, section, tab, by-component)
 * so a link or a browser-back lands on the same view. Clones
 * `results/index.tsx`'s "pick an exam" loader shape and adds a section
 * `Select` scoped to that exam's class.
 *
 * Plan corrections (see the `## Plan — #1001` GitHub comment for the
 * full list): no `Switch` component exists in `@biddaloy/ui` — the
 * "by component" toggle reuses `Checkbox`, the same primitive
 * `ResultsPanel`'s own `failOnly` filter already uses. Each tab renders
 * its rows through `DataTable`, which already collapses to a card list
 * below 768px container width (`data-table.tsx`'s [8.14.7] card mode) —
 * that satisfies step 7's "phone renders as cards" requirement without a
 * hand-rolled breakpoint.
 */
import {
  EmptyState,
  ErrorState,
  RoutePending,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Skeleton,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from '@biddaloy/ui/components';
import { examsQueryOptions, useClassSections, useExams } from '@biddaloy/ui/hooks';
import { useTranslation } from '@biddaloy/ui/i18n';
import { createFileRoute } from '@tanstack/react-router';
import * as React from 'react';
import { z } from 'zod';

import { loadRouteNamespaces, swallowUnlessOffline } from '../../../route-loaders';

import './-analysis-print.css';

import { DefaultedTab } from './-defaulted-tab';
import { MeritTab } from './-merit-tab';
import { PassFailTab } from './-pass-fail-tab';

const TABS = ['merit', 'defaulted', 'pass-fail'] as const;
export type AnalysisTab = (typeof TABS)[number];

const searchSchema = z.object({
  examId: z.string().optional(),
  sectionId: z.string().optional(),
  tab: z.enum(TABS).catch('merit'),
  byComponent: z.boolean().optional().catch(undefined),
});

export const Route = createFileRoute('/_staff/analysis/')({
  validateSearch: searchSchema,
  loader: ({ context: { queryClient } }) =>
    Promise.all([
      queryClient.ensureQueryData(examsQueryOptions({})).catch(swallowUnlessOffline),
      loadRouteNamespaces('exams', 'common'),
    ]),
  pendingComponent: AnalysisPending,
  component: AnalysisPage,
});

function AnalysisPage() {
  const { t } = useTranslation('exams');
  const { t: tNav } = useTranslation('nav');
  const { examId, sectionId, tab, byComponent } = Route.useSearch();
  const navigate = Route.useNavigate();

  const examsQuery = useExams({ limit: 50 });
  const exams = examsQuery.data?.data ?? [];
  const selectedExamId = examId ?? exams[0]?.id;
  const selectedExam = exams.find((exam) => exam.id === selectedExamId);

  const sectionsQuery = useClassSections(selectedExam?.class_id);
  const sections = sectionsQuery.data ?? [];
  const selectedSection = sections.find((section) => section.id === sectionId);

  React.useEffect(() => {
    if (!selectedExam) return;
    const tabLabel = t(`analysis.tabs.${tab === 'pass-fail' ? 'passFail' : tab}`);
    document.title = `${tabLabel} · ${selectedExam.name}`;
  }, [selectedExam, tab, t]);

  function setExam(nextExamId: string) {
    void navigate({ search: (prev) => ({ ...prev, examId: nextExamId, sectionId: undefined }) });
  }

  function setSection(nextSectionId: string) {
    void navigate({
      search: (prev) => ({
        ...prev,
        sectionId: nextSectionId === '__all__' ? undefined : nextSectionId,
      }),
    });
  }

  function setTab(nextTab: string) {
    void navigate({ search: (prev) => ({ ...prev, tab: nextTab as AnalysisTab }) });
  }

  function setByComponent(next: boolean) {
    void navigate({ search: (prev) => ({ ...prev, byComponent: next ? true : undefined }) });
  }

  return (
    <div className="flex flex-col gap-4 p-4">
      <h1 className="text-lg font-semibold">{tNav('items.analysis', { ns: 'nav' })}</h1>

      {examsQuery.isLoading ? (
        <Skeleton className="h-10 w-64" />
      ) : examsQuery.isError ? (
        <ErrorState
          message={t('resultsRoute.loadError')}
          onRetry={() => void examsQuery.refetch()}
        />
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-2 print:hidden">
            <Select value={selectedExamId ?? ''} onValueChange={setExam}>
              <SelectTrigger aria-label={t('resultsRoute.examLabel')} className="w-64">
                <SelectValue placeholder={t('resultsRoute.examPlaceholder')} />
              </SelectTrigger>
              <SelectContent>
                {exams.map((exam) => (
                  <SelectItem key={exam.id} value={exam.id}>
                    {exam.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            {selectedExam && (
              <Select value={sectionId ?? '__all__'} onValueChange={setSection}>
                <SelectTrigger aria-label={t('analysis.sectionFilter')} className="w-48">
                  <SelectValue placeholder={t('analysis.sectionFilter')} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__all__">{t('analysis.allSections')}</SelectItem>
                  {sections.map((section) => (
                    <SelectItem key={section.id} value={section.id}>
                      {section.section_name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </div>

          {!selectedExam ? (
            <p className="text-sm text-muted-foreground">{t('resultsRoute.selectExamHint')}</p>
          ) : selectedExam.status === 'DRAFT' ? (
            <EmptyState
              title={t('analysis.empty.notProcessed')}
              explanation={t('resultsPanel.empty')}
              action={{
                label: t('resultsPanel.process'),
                onClick: () =>
                  void navigate({ to: '/exams/$examId', params: { examId: selectedExam.id } }),
              }}
            />
          ) : (
            <Tabs value={tab} onValueChange={setTab}>
              <TabsList className="print:hidden">
                <TabsTrigger value="merit">{t('analysis.tabs.merit')}</TabsTrigger>
                <TabsTrigger value="defaulted">{t('analysis.tabs.defaulted')}</TabsTrigger>
                <TabsTrigger value="pass-fail">{t('analysis.tabs.passFail')}</TabsTrigger>
              </TabsList>

              <TabsContent value="merit">
                <MeritTab
                  examId={selectedExam.id}
                  examName={selectedExam.name}
                  sectionId={sectionId}
                  sectionName={selectedSection?.section_name}
                  className={selectedExam.class.name}
                />
              </TabsContent>
              <TabsContent value="defaulted">
                <DefaultedTab
                  examId={selectedExam.id}
                  examName={selectedExam.name}
                  sectionId={sectionId}
                  sectionName={selectedSection?.section_name}
                  className={selectedExam.class.name}
                />
              </TabsContent>
              <TabsContent value="pass-fail">
                <PassFailTab
                  examId={selectedExam.id}
                  examName={selectedExam.name}
                  sectionId={sectionId}
                  sectionName={selectedSection?.section_name}
                  className={selectedExam.class.name}
                  byComponent={byComponent ?? false}
                  onByComponentChange={setByComponent}
                />
              </TabsContent>
            </Tabs>
          )}
        </>
      )}
    </div>
  );
}

function AnalysisPending() {
  const { t } = useTranslation('nav');
  return <RoutePending variant="list" label={t('routePending.label', { ns: 'nav' })} />;
}

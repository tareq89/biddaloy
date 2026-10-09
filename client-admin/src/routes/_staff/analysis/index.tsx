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
import { Permission } from '@biddaloy/shared';
import {
  EmptyState,
  ErrorState,
  Label,
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
  toast,
} from '@biddaloy/ui/components';
import {
  downloadAnalysisCsv,
  examsQueryOptions,
  useClassSections,
  useExams,
  useHasPermission,
} from '@biddaloy/ui/hooks';
import { useTranslation } from '@biddaloy/ui/i18n';
import { PageContainer, PageHeader } from '@biddaloy/ui/shells';
import { createFileRoute } from '@tanstack/react-router';
import { DownloadIcon, FileClockIcon, FilePenLineIcon, PrinterIcon } from 'lucide-react';
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
      // Same key `useExams({ limit: 50 })` reads below.
      queryClient.ensureQueryData(examsQueryOptions({ limit: 50 })).catch(swallowUnlessOffline),
      loadRouteNamespaces('exams', 'grading', 'common', 'nav'),
    ]),
  pendingComponent: AnalysisPending,
  component: AnalysisPage,
});

function AnalysisPage() {
  const { t } = useTranslation('exams');
  const { t: tg } = useTranslation('grading');
  const { t: tNav } = useTranslation('nav');
  const canManageExam = useHasPermission(Permission.EXAM_MANAGE);
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
    const tabLabel = tg(`analysisPage.tabs.${tab === 'pass-fail' ? 'passFail' : tab}`);
    document.title = `${tabLabel} · ${selectedExam.name}`;
  }, [selectedExam, tab, tg]);

  // One toolbar for the page; it acts on the selected tab.
  const [csvBusy, setCsvBusy] = React.useState(false);
  async function handleDownloadCsv() {
    if (!selectedExam) return;
    setCsvBusy(true);
    try {
      await downloadAnalysisCsv(selectedExam.id, tab, sectionId, selectedExam.name);
    } catch {
      toast.error(t('analysis.downloadCsvError'));
    } finally {
      setCsvBusy(false);
    }
  }
  const ready = selectedExam !== undefined && selectedExam.status !== 'DRAFT';

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
    <PageContainer>
      <div className="print:hidden">
        <PageHeader
          title={tNav('items.analysis')}
          subtitle={tg('analysisPage.subtitle')}
          actions={[
            {
              id: 'print',
              label: tg('analysisPage.print'),
              icon: <PrinterIcon />,
              onClick: () => window.print(),
              allowed: ready,
            },
            {
              id: 'csv',
              label: tg('analysisPage.downloadCsv'),
              icon: <DownloadIcon />,
              onClick: () => void handleDownloadCsv(),
              allowed: ready,
              busy: csvBusy,
            },
          ]}
        />
      </div>

      {examsQuery.isLoading ? (
        <div className="flex flex-col gap-4 md:flex-row">
          <Skeleton className="h-11 w-full md:h-8 md:w-96" />
          <Skeleton className="h-11 w-full md:h-8 md:w-56" />
        </div>
      ) : examsQuery.isError ? (
        <ErrorState
          message={t('resultsRoute.loadError')}
          onRetry={() => void examsQuery.refetch()}
        />
      ) : exams.length === 0 ? (
        <EmptyState
          icon={<FilePenLineIcon />}
          title={tg('marksEntry.noExamsTitle')}
          explanation={tg('marksEntry.noExamsText')}
        />
      ) : (
        <>
          <div className="flex flex-col gap-4 md:flex-row md:items-end print:hidden">
            <div className="flex flex-col gap-1.5 md:w-96 md:shrink-0">
              <Label htmlFor="analysis-exam">{t('resultsRoute.examLabel')}</Label>
              <Select value={selectedExamId ?? ''} onValueChange={setExam}>
                <SelectTrigger id="analysis-exam" className="w-full">
                  <SelectValue placeholder={t('resultsRoute.examPlaceholder')} />
                </SelectTrigger>
                <SelectContent>
                  {exams.map((exam) => (
                    <SelectItem key={exam.id} value={exam.id}>
                      {exam.class?.name
                        ? tg('marksEntry.examOption', { exam: exam.name, class: exam.class.name })
                        : exam.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {selectedExam && (
              <div className="flex flex-col gap-1.5 md:w-56 md:shrink-0">
                <Label htmlFor="analysis-section">{t('analysis.sectionFilter')}</Label>
                <Select value={sectionId ?? '__all__'} onValueChange={setSection}>
                  <SelectTrigger id="analysis-section" className="w-full">
                    <SelectValue placeholder={t('analysis.sectionFilter')} />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__all__">{tg('analysisPage.allSections')}</SelectItem>
                    {sections.map((section) => (
                      <SelectItem key={section.id} value={section.id}>
                        {section.section_name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
          </div>

          {!selectedExam ? (
            <p className="text-text-secondary">{t('resultsRoute.selectExamHint')}</p>
          ) : selectedExam.status === 'DRAFT' ? (
            <EmptyState
              icon={<FileClockIcon />}
              title={tg('analysisPage.notProcessedTitle')}
              explanation={tg('analysisPage.notProcessedText')}
              {...(canManageExam
                ? {
                    action: {
                      label: tg('analysisPage.openExam'),
                      onClick: () =>
                        void navigate({
                          to: '/exams/$examId',
                          params: { examId: selectedExam.id },
                        }),
                    },
                  }
                : {})}
            />
          ) : (
            <Tabs value={tab} onValueChange={setTab}>
              <TabsList className="print:hidden">
                <TabsTrigger value="merit">{tg('analysisPage.tabs.merit')}</TabsTrigger>
                <TabsTrigger value="defaulted">{tg('analysisPage.tabs.defaulted')}</TabsTrigger>
                <TabsTrigger value="pass-fail">{tg('analysisPage.tabs.passFail')}</TabsTrigger>
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
    </PageContainer>
  );
}

function AnalysisPending() {
  const { t } = useTranslation('nav');
  return <RoutePending variant="list" label={t('routePending.label', { ns: 'nav' })} />;
}

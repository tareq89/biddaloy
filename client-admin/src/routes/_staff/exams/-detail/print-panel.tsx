/**
 * Print tab — [48.3.A-02]. Every exam document as a card, grouped by phase (D11, D16). Only the
 * admit card is filled (D34). An unavailable card says why and links to the fix (D15).
 */
import { ExamStatus, Permission } from '@biddaloy/shared';
import {
  DocumentCard,
  ErrorState,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Skeleton,
} from '@biddaloy/ui/components';
import {
  resultsQueryOptions,
  useAdmitCardRoster,
  useClassSections,
  useExam,
  useExamComponentsAll,
  useExamSchedule,
  useHasPermission,
  useSeatPlans,
} from '@biddaloy/ui/hooks';
import { useRegionConfig, useTranslation } from '@biddaloy/ui/i18n';
import { formatNumber } from '@biddaloy/ui/utils';
import { useQueryClient } from '@tanstack/react-query';
import { useRouter } from '@tanstack/react-router';
import * as React from 'react';

import { examPreviewHref } from '../../../../components/print/exam-preview-href';

import { MeritDialog } from './merit-dialog';

export interface PrintPanelProps {
  examId: string;
}

const GRID = 'grid gap-4 md:grid-cols-2 xl:grid-cols-4';
const CALLOUT = 'mt-3 rounded-md bg-status-due-bg p-3 text-status-due-fg';

const q = (params: Record<string, string>) => new URLSearchParams(params).toString();

export function PrintPanel({ examId }: PrintPanelProps) {
  const { t } = useTranslation('examDocuments');
  const config = useRegionConfig();
  const router = useRouter();
  const queryClient = useQueryClient();
  const canResults = useHasPermission(Permission.RESULT_READ);
  const examQuery = useExam(examId);
  const exam = examQuery.data;
  const schedule = useExamSchedule(examId);
  const components = useExamComponentsAll(examId);
  const plans = useSeatPlans({ examId });
  const roster = useAdmitCardRoster(examId);
  const sections = useClassSections(exam?.class_id);
  const [reportSection, setReportSection] = React.useState<string | undefined>(undefined);
  const [tabSection, setTabSection] = React.useState<string | undefined>(undefined);
  const [meritOpen, setMeritOpen] = React.useState(false);

  const queries = [examQuery, schedule, components, plans, roster];
  if (queries.some((x) => x.isPending)) {
    return (
      <div className="flex flex-col gap-4" aria-busy="true">
        <Skeleton className="h-48 w-full" />
        <Skeleton className="h-32 w-full" />
      </div>
    );
  }
  if (queries.some((x) => x.isError) || !exam) {
    return (
      <ErrorState
        message={t('page.loadError')}
        onRetry={() => queries.forEach((x) => void x.refetch())}
      />
    );
  }

  const here = `/exams/${examId}`;
  const published = plans.data?.find((p) => p.status === 'PUBLISHED');
  const seatUnavailable = published
    ? undefined
    : {
        reason: t('unavailable.noSeatPlan'),
        fixLabel: t('fix.makeSeatPlan'),
        fixHref: '/exams/seat-plans?generate=1',
      };
  const resultsUnavailable =
    exam.status === ExamStatus.PUBLISHED
      ? undefined
      : {
          reason: t('unavailable.notPublished'),
          fixLabel: t('fix.goToResults'),
          fixHref: `${here}?tab=results`,
        };
  const doc = (name: string, extra: Record<string, string> = {}) =>
    `/print/document?${q({ doc: name, exam_id: examId, ...extra })}`;

  const rows = roster.data?.students ?? [];
  const printed = rows.filter((s) => s.printed_copies > 0).length;
  const dues = rows.filter((s) => s.has_dues === true).length;
  const n = (v: number) => formatNumber(v, config);
  const scheduleCount = schedule.data?.length ?? 0;
  const sectionList = sections.data ?? [];
  const reportSectionId = reportSection ?? sectionList[0]?.id;
  const tabSectionId = tabSection ?? sectionList[0]?.id;
  const admitHref = examPreviewHref(examId, 'EXAM_ADMIT_CARD');

  const sectionSelect = (id: string, value: string | undefined, onChange: (v: string) => void) => (
    <div className="mt-3 flex flex-col gap-1.5">
      <span className="text-label" id={id}>
        {t('sectionLabel')}
      </span>
      <Select value={value ?? ''} onValueChange={onChange}>
        <SelectTrigger aria-labelledby={id} className="w-full">
          <SelectValue placeholder={t('sectionPlaceholder')} />
        </SelectTrigger>
        <SelectContent>
          {sectionList.map((s) => (
            <SelectItem key={s.id} value={s.id}>
              {s.section_name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );

  /** Fetched at click time, so no results call happens until someone asks. */
  async function printResultCertificates() {
    const results = await queryClient.fetchQuery(resultsQueryOptions(examId));
    const ids = [...results]
      .filter((r) => !r.is_fail)
      .sort((a, b) => a.roll_number - b.roll_number)
      .map((r) => r.student_id)
      .join(',');
    router.history.push(examPreviewHref(examId, 'RESULT_CERTIFICATE', { ids }));
  }

  return (
    <div className="flex flex-col gap-8">
      <section aria-labelledby="phase-before" className="flex flex-col gap-3">
        <PhaseHeading
          id="phase-before"
          title={t('phase.before')}
          hint={t('phase.beforeHintPlain')}
        />
        <div className={GRID}>
          <DocumentCard
            className="xl:col-span-3"
            title={t('admitCard.title')}
            description={t('admitCard.description')}
            meta={t('admitCard.chooseHint')}
            action={{ label: t('admitCard.action'), href: admitHref, primary: true }}
            {...(seatUnavailable ? { unavailable: seatUnavailable } : {})}
          >
            <dl className="mt-3 grid grid-cols-3 gap-2 border-y border-border-subtle py-3">
              {(
                [
                  ['examinees', rows.length],
                  ['printed', printed],
                  ['remaining', rows.length - printed],
                ] as const
              ).map(([key, value]) => (
                <div key={key}>
                  <dt className="text-caption text-text-secondary">{t(`admitCard.${key}`)}</dt>
                  <dd className="text-h3">{n(value)}</dd>
                </div>
              ))}
            </dl>
            {dues > 0 && roster.data?.withhold_for_dues !== false ? (
              <p role="status" className={CALLOUT}>
                {t('admitCard.dues', { count: dues, n: n(dues) })}{' '}
                <a className="font-medium underline" href={admitHref}>
                  {t('admitCard.duesLink')}
                </a>
              </p>
            ) : null}
          </DocumentCard>
          <DocumentCard
            title={t('routine.title')}
            description={t('routine.description')}
            action={{ label: t('routine.action'), href: doc('routine') }}
            {...(scheduleCount === 0
              ? {
                  unavailable: {
                    reason: t('unavailable.noSchedule'),
                    fixLabel: t('fix.addSchedule'),
                    fixHref: `${here}?tab=schedule`,
                  },
                }
              : {})}
          />
        </div>
      </section>

      <section aria-labelledby="phase-hall" className="flex flex-col gap-3">
        <PhaseHeading
          id="phase-hall"
          title={t('phase.inHall')}
          {...(published
            ? {
                hint: t('phase.inHallHint', {
                  rooms: n(published.room_count),
                  sittings: n(published.schedule_count),
                }),
              }
            : {})}
        />
        <div className={GRID}>
          {(
            [
              ['seatList', 'seat-list'],
              ['invigilator', 'invigilator'],
              ['stickers', 'stickers'],
            ] as const
          ).map(([key, name]) => (
            <DocumentCard
              key={key}
              title={t(`${key}.title`)}
              description={t(`${key}.description`)}
              action={{ label: t(`${key}.action`), href: doc(name) }}
              {...(seatUnavailable ? { unavailable: seatUnavailable } : {})}
            />
          ))}
          <DocumentCard
            title={t('marksSheet.title')}
            description={t('marksSheet.description')}
            action={{ label: t('marksSheet.action'), href: doc('marks-sheet') }}
            {...((components.data?.length ?? 0) === 0
              ? {
                  unavailable: {
                    reason: t('unavailable.noComponents'),
                    fixLabel: t('fix.addComponents'),
                    fixHref: `${here}?tab=setup`,
                  },
                }
              : {})}
          />
        </div>
      </section>

      <section aria-labelledby="phase-after" className="flex flex-col gap-3">
        <PhaseHeading id="phase-after" title={t('phase.after')} hint={t('phase.afterHint')} />
        <div className={GRID}>
          {canResults ? (
            <DocumentCard
              title={t('reportCard.title')}
              description={t('reportCard.description')}
              action={{
                label: t('reportCard.action'),
                href: doc('report-cards', reportSectionId ? { section_id: reportSectionId } : {}),
              }}
              {...(resultsUnavailable ? { unavailable: resultsUnavailable } : {})}
            >
              {sectionSelect('print-report-section', reportSectionId, setReportSection)}
            </DocumentCard>
          ) : null}
          <DocumentCard
            title={t('tabulation.title')}
            description={t('tabulation.description')}
            action={{
              label: t('tabulation.action'),
              href: doc('tabulation', tabSectionId ? { section_id: tabSectionId } : {}),
            }}
            {...(exam.status === ExamStatus.DRAFT
              ? {
                  unavailable: {
                    reason: t('unavailable.notProcessed'),
                    fixLabel: t('fix.seeProgress'),
                    fixHref: `${here}?tab=progress`,
                  },
                }
              : {})}
          >
            {sectionSelect('print-tab-section', tabSectionId, setTabSection)}
          </DocumentCard>
          <DocumentCard
            title={t('resultCertificate.title')}
            description={t('resultCertificate.description')}
            action={{
              label: t('resultCertificate.action'),
              onClick: () => void printResultCertificates(),
            }}
            {...(resultsUnavailable ? { unavailable: resultsUnavailable } : {})}
          />
          <DocumentCard
            title={t('meritCertificate.title')}
            description={t('meritCertificate.description')}
            action={{ label: t('meritCertificate.action'), onClick: () => setMeritOpen(true) }}
            {...(resultsUnavailable ? { unavailable: resultsUnavailable } : {})}
          />
        </div>
      </section>
      <MeritDialog examId={examId} open={meritOpen} onOpenChange={setMeritOpen} />
    </div>
  );
}

function PhaseHeading({ id, title, hint }: { id: string; title: string; hint?: string }) {
  return (
    <div className="flex flex-wrap items-baseline gap-x-3">
      <h2 id={id} className="text-h2">
        {title}
      </h2>
      {hint ? <p className="text-text-secondary">{hint}</p> : null}
    </div>
  );
}

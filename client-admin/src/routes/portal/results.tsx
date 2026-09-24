/**
 * [19.9.1] — the guardian/student portal's own results page. Cloned from
 * `portal/fees.tsx`'s shell exactly (issue step 1): same loading/empty/
 * error frames, same `?student=` picker wiring, same "no `<h1>` while
 * pending/erroring" heading contract.
 *
 * **Published only (D19).** `GET /students/:studentId/results` already
 * does the filtering server-side (`ResultsService.listForStudent` with
 * `publishedOnly: true` for a PARENT/STUDENT caller) — an unpublished exam
 * never appears in `useStudentResults`'s response at all, so there is
 * nothing here to grey out or hide. Each row expands to the full
 * subject/component breakdown (`useStudentResultCard`, fetched only once
 * expanded) and offers Print, which renders `ReportCard` — the same
 * component the staff-only `/results/$examId/$studentId` route (#904)
 * prints from, reused rather than re-declared.
 */
import {
  Card,
  EmptyState,
  ErrorState,
  ReportCard,
  RoutePending,
  Skeleton,
  StudentPicker,
  type ReportCardData,
} from '@biddaloy/ui/components';
import {
  myStudentsQueryOptions,
  useMyStudents,
  useStudentResultCard,
  useStudentResults,
  type Student,
} from '@biddaloy/ui/hooks';
import { useTranslation } from '@biddaloy/ui/i18n';
import { createFileRoute } from '@tanstack/react-router';
import { PrinterIcon } from 'lucide-react';
import * as React from 'react';
import { z } from 'zod';

import { loadRouteNamespaces, swallowUnlessOffline } from '../../route-loaders';

const resultsSearchSchema = z.object({
  /** Same contract as `portal/fees.tsx`'s `student` param — not trusted to
   * widen anything, the server re-checks the link on every request. */
  student: z.string().optional().catch(undefined),
});

export const Route = createFileRoute('/portal/results')({
  validateSearch: resultsSearchSchema,
  loader: ({ context: { queryClient } }) =>
    Promise.all([
      queryClient.ensureQueryData(myStudentsQueryOptions()).catch(swallowUnlessOffline),
      loadRouteNamespaces('portal', 'common', 'exams'),
    ]),
  pendingComponent: PortalResultsPending,
  component: PortalResults,
});

/** The same "class section · roll" line `portal/fees.tsx`'s own
 * `useStudentMeta` renders, from the same two keys. */
function useStudentMeta(): (student: Student) => string {
  const { t } = useTranslation('portal');
  return (student: Student) => {
    const className = student.class_section?.class?.name ?? null;
    return className === null
      ? t('children.metaNoClass', { roll: student.roll_number })
      : t('children.meta', {
          className,
          section: student.class_section?.section_name ?? '',
          roll: student.roll_number,
        });
  };
}

function PortalResults() {
  const { t } = useTranslation('portal');
  const search = Route.useSearch();
  const studentMeta = useStudentMeta();

  const studentsQuery = useMyStudents();
  const students: Student[] = studentsQuery.data ?? [];

  const selected =
    students.find((student) => student.id === search.student) ?? students[0] ?? undefined;

  const resultsQuery = useStudentResults(selected?.id);
  const [printingExamId, setPrintingExamId] = React.useState<string | null>(null);

  if (studentsQuery.isPending) return <ResultsSkeleton label={t('results.loading')} />;

  if (studentsQuery.isError) {
    return (
      <ErrorState
        message={t('results.error.message')}
        retryLabel={t('results.error.retry')}
        onRetry={() => void studentsQuery.refetch()}
      />
    );
  }

  if (students.length === 0 || selected === undefined) {
    return (
      <EmptyState
        title={t('empty.title')}
        explanation={t('empty.explanation')}
        action={{ label: t('empty.action'), onClick: () => void studentsQuery.refetch() }}
      />
    );
  }

  if (resultsQuery.isPending) {
    return <ResultsSkeleton label={t('results.loading')} showPicker={students.length > 1} />;
  }

  if (resultsQuery.isError) {
    return (
      <ErrorState
        message={t('results.error.message')}
        retryLabel={t('results.error.retry')}
        onRetry={() => void resultsQuery.refetch()}
      />
    );
  }

  return (
    <div className="flex max-w-2xl flex-col gap-3 print:hidden">
      <div className="flex flex-col gap-0.5">
        <h1 className="text-lg font-semibold tracking-tight">{t('results.title')}</h1>
        <p className="text-xs text-muted-foreground">
          {`${selected.full_name} · ${studentMeta(selected)}`}
        </p>
      </div>
      {students.length > 1 && (
        <StudentPicker
          label={t('fees.pickerLabel')}
          items={students.map((student) => ({
            id: student.id,
            name: student.full_name,
            meta: studentMeta(student),
          }))}
          selectedId={selected.id}
          to="/portal/results"
        />
      )}

      {resultsQuery.data.length === 0 ? (
        // Not an error: results appear once the school publishes them
        // (D19, issue step 5) — plain paragraph, not `EmptyState`, since
        // this frame already has its `<h1>` above.
        <p className="p-3.5 text-sm text-muted-foreground">{t('results.empty')}</p>
      ) : (
        <Card className="flex flex-col">
          {resultsQuery.data.map((row, index) => (
            <ResultRow
              key={row.exam_id}
              row={row}
              studentId={selected.id}
              bordered={index > 0}
              onPrint={() => setPrintingExamId(row.exam_id)}
            />
          ))}
        </Card>
      )}

      {printingExamId !== null && (
        <PrintTarget
          studentId={selected.id}
          examId={printingExamId}
          onDone={() => setPrintingExamId(null)}
        />
      )}
    </div>
  );
}

interface StudentResultRow {
  exam_id: string;
  exam_name: string;
  exam_kind: string;
  published: boolean;
  total_marks: number;
  gpa: number;
  grade: string;
  position: number | null;
  is_fail: boolean;
}

function ResultRow({
  row,
  studentId,
  bordered,
  onPrint,
}: {
  row: StudentResultRow;
  studentId: string;
  bordered: boolean;
  onPrint: () => void;
}) {
  const { t } = useTranslation('portal');
  const [expanded, setExpanded] = React.useState(false);

  return (
    <details
      className={bordered ? 'border-t border-border-subtle' : undefined}
      onToggle={(e) => setExpanded(e.currentTarget.open)}
    >
      <summary className="flex cursor-pointer flex-wrap items-center justify-between gap-2 px-3.5 py-3 text-sm">
        <span className="min-w-0 flex-1">
          <span className="font-semibold">{row.exam_name}</span>
          {row.is_fail && (
            <span className="ms-1.5 text-[11px] font-normal text-destructive">
              {t('results.failTag')}
            </span>
          )}
        </span>
        <span className="text-sm font-semibold tabular-nums">{row.grade}</span>
        <button
          type="button"
          aria-label={t('results.printLabel', { name: row.exam_name })}
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            onPrint();
          }}
          className="flex size-11 flex-shrink-0 items-center justify-center rounded-md text-muted-foreground"
        >
          <PrinterIcon className="size-4.5" aria-hidden="true" />
        </button>
      </summary>
      {expanded && <ResultBreakdown studentId={studentId} examId={row.exam_id} />}
    </details>
  );
}

function ResultBreakdown({ studentId, examId }: { studentId: string; examId: string }) {
  const { t } = useTranslation('portal');
  const cardQuery = useStudentResultCard(studentId, examId);

  if (cardQuery.isPending) return <Skeleton className="mx-3.5 mb-3 h-16 w-auto" />;
  if (cardQuery.isError) {
    return <p className="px-3.5 pb-3 text-xs text-destructive">{t('results.breakdownError')}</p>;
  }

  const card = cardQuery.data;
  return (
    <dl className="flex flex-col gap-1.5 px-3.5 pb-3">
      {card.subjects.map((subject) => (
        <div key={subject.subject_name} className="flex items-center justify-between gap-2 text-xs">
          <dt className="text-muted-foreground">{subject.subject_name}</dt>
          <dd className="tabular-nums">
            {subject.obtained} — {subject.grade}
          </dd>
        </div>
      ))}
    </dl>
  );
}

/** Off-screen render of `ReportCard`, printed once its data has loaded,
 * then discarded. `print:hidden` on the page's own content above hides
 * everything else, so this is the only thing the browser's print dialog
 * ever shows. */
function PrintTarget({
  studentId,
  examId,
  onDone,
}: {
  studentId: string;
  examId: string;
  onDone: () => void;
}) {
  // `{ ns: 'exams' }` on every call below rather than
  // `useTranslation('exams')` — this file's other components all use the
  // 'portal' namespace, and `check-i18n-keys.mjs`'s namespace-resolution
  // regex picks one dominant namespace per file rather than parsing
  // per-hook scope (`portal/fees.tsx`'s own header comment notes the same
  // gap), so a bound `useTranslation('exams')` here gets misrouted as
  // "portal" and every 'reportCard.*' key reads as missing.
  const { t, i18n } = useTranslation();
  const cardQuery = useStudentResultCard(studentId, examId);

  React.useEffect(() => {
    if (!cardQuery.data) return;
    window.print();
    onDone();
    // Fires once, right after the data this print needs has arrived.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cardQuery.data]);

  if (!cardQuery.data) return null;

  const card = cardQuery.data;
  const data: ReportCardData = {
    exam_name: card.exam_name,
    student: card.student,
    result: card.result,
    subjects: card.subjects,
    legend: card.legend,
  };

  return (
    <div className="hidden print:block">
      <ReportCard
        data={data}
        issuer={card.issuer}
        logoUrl={card.logo_url}
        activeLanguage={i18n.language}
        labels={{
          examLabel: t('reportCard.examLabel', { ns: 'exams' }),
          rollLabel: t('reportCard.rollLabel', { ns: 'exams' }),
          subject: t('reportCard.subject', { ns: 'exams' }),
          obtained: t('reportCard.obtained', { ns: 'exams' }),
          grade: t('reportCard.grade', { ns: 'exams' }),
          gpa: t('reportCard.gpa', { ns: 'exams' }),
          totalMarks: t('reportCard.totalMarks', { ns: 'exams' }),
          totalGpa: t('reportCard.totalGpa', { ns: 'exams' }),
          overallGrade: t('reportCard.overallGrade', { ns: 'exams' }),
          position: t('reportCard.position', { ns: 'exams' }),
          positionValue: t('reportCard.positionValue', { ns: 'exams' }),
          fail: t('reportCard.fail', { ns: 'exams' }),
          fourthSubject: t('reportCard.fourthSubject', { ns: 'exams' }),
          absent: t('reportCard.absent', { ns: 'exams' }),
          legendTitle: t('reportCard.legendTitle', { ns: 'exams' }),
        }}
      />
    </div>
  );
}

function ResultsSkeleton({ label, showPicker = false }: { label: string; showPicker?: boolean }) {
  return (
    <div className="flex max-w-2xl flex-col gap-3" aria-busy="true" aria-live="polite">
      <span className="sr-only">{label}</span>
      <div className="flex flex-col gap-0.5">
        <Skeleton className="h-7 w-2/5" />
        <Skeleton className="h-4 w-3/5" />
      </div>
      {showPicker && <Skeleton className="h-12 w-full rounded-lg" />}
      <Skeleton className="h-32 w-full rounded-lg" />
    </div>
  );
}

function PortalResultsPending() {
  const { t } = useTranslation('nav');
  return <RoutePending variant="list" label={t('routePending.label', { ns: 'nav' })} />;
}

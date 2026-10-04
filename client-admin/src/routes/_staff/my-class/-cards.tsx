/**
 * [47.4.2] The six cards of `/my-class/$sectionId`, in D15 order. Every card
 * owns its own query, so each loads, fails and retries independently (D14):
 * one dead endpoint shows a retry inside that card and the rest still render.
 */
import { Button, Card, Skeleton } from '@biddaloy/ui/components';
import {
  classPerformanceQueryOptions,
  useAttendanceStreaks,
  useDefaultedList,
  useExams,
  useFeeDues,
  useSectionHomeworkRollup,
  useSectionRegister,
  useStudents,
  type AttendanceStreak,
} from '@biddaloy/ui/hooks';
import { useRegionConfig, useTranslation } from '@biddaloy/ui/i18n';
import { formatServerAmount } from '@biddaloy/ui/utils';
import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import type { ReactNode } from 'react';

const ROWS = 5;

// Local getters, not `toISOString()` (UTC would be yesterday in Asia/Dhaka
// before 06:00) — same note as `attendance/index.tsx`.
export function todayIso(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

interface CardState {
  isPending: boolean;
  isError: boolean;
  retry: () => void;
}

function CardFrame({
  id,
  title,
  state,
  empty,
  children,
}: {
  id: string;
  title: string;
  state: CardState;
  /** Empty-line text; when set the body is replaced by it. */
  empty?: string | undefined;
  children?: ReactNode;
}) {
  const { t } = useTranslation('myClass');
  let body: ReactNode;
  if (state.isPending) {
    body = (
      <div className="flex flex-col gap-2" aria-hidden="true">
        <Skeleton className="h-4 w-2/3" />
        <Skeleton className="h-4 w-1/2" />
      </div>
    );
  } else if (state.isError) {
    body = (
      <div role="alert" className="flex flex-col items-start gap-2">
        <p className="text-sm text-muted-foreground">{t('cardError')}</p>
        <Button variant="outline" size="sm" onClick={state.retry}>
          {t('retry')}
        </Button>
      </div>
    );
  } else if (empty !== undefined) {
    body = <p className="text-sm text-muted-foreground">{empty}</p>;
  } else {
    body = children;
  }
  return (
    <Card asChild>
      <section aria-labelledby={id} className="flex flex-col gap-3 p-4">
        <h2 id={id} className="text-base font-semibold">
          {title}
        </h2>
        {body}
      </section>
    </Card>
  );
}

const SEE_ALL_CLASS =
  'self-start text-sm font-medium text-primary underline-offset-4 hover:underline';

function Row({ left, right }: { left: ReactNode; right?: ReactNode }) {
  return (
    <li className="flex min-h-9 items-center justify-between gap-3 text-sm">
      <span>{left}</span>
      {right !== undefined && <span className="text-muted-foreground">{right}</span>}
    </li>
  );
}

// --- 1. Today's absentees -------------------------------------------------

export function AbsenteesCard({ sectionId }: { sectionId: string }) {
  const { t } = useTranslation('myClass');
  const query = useSectionRegister(sectionId, todayIso());
  const absent = (query.data?.students ?? []).filter((s) => s.status === 'ABSENT');
  return (
    <CardFrame
      id="my-class-absentees"
      title={t('cards.absentees')}
      state={{
        isPending: query.isPending,
        isError: query.isError,
        retry: () => void query.refetch(),
      }}
      empty={absent.length === 0 ? t('cardEmpty.absentees') : undefined}
    >
      <ul className="flex flex-col">
        {absent.slice(0, ROWS).map((s) => (
          <Row key={s.student_id} left={s.full_name} right={t('roll', { roll: s.roll_number })} />
        ))}
      </ul>
      {absent.length > ROWS && (
        <Link
          className={SEE_ALL_CLASS}
          to="/attendance/$sectionId"
          params={{ sectionId }}
          search={{ date: todayIso() }}
        >
          {t('seeAll')}
        </Link>
      )}
    </CardFrame>
  );
}

// --- 2. Attendance flags --------------------------------------------------

const FLAG_GROUPS = ['ABSENT', 'LATE', 'PRESENT'] as const;

export function FlagsCard({ sectionId }: { sectionId: string }) {
  const { t } = useTranslation('myClass');
  const query = useAttendanceStreaks(sectionId);
  const items: AttendanceStreak[] = query.data?.items ?? [];
  return (
    <CardFrame
      id="my-class-flags"
      title={t('cards.flags')}
      state={{
        isPending: query.isPending,
        isError: query.isError,
        retry: () => void query.refetch(),
      }}
      empty={items.length === 0 ? t('cardEmpty.flags') : undefined}
    >
      {FLAG_GROUPS.map((status) => {
        const group = items.filter((i) => i.status === status);
        if (group.length === 0) return null;
        return (
          <div key={status} className="flex flex-col">
            <h3 className="text-sm font-medium">{t(`flagGroups.${status}`)}</h3>
            <ul className="flex flex-col">
              {group.map((i) => (
                <Row
                  key={i.student_id}
                  left={i.student_name}
                  right={t('flagDays', { count: i.length })}
                />
              ))}
            </ul>
          </div>
        );
      })}
    </CardFrame>
  );
}

// --- 3. Dues --------------------------------------------------------------

// ponytail: one page of 100 (the endpoint's cap) summed client-side — the
// response has no section-wide total. A section with >100 indebted students
// under-reports the sum; add a server-side aggregate if that ever happens.
const DUES_PAGE = 100;

export function DuesCard({ sectionId }: { sectionId: string }) {
  const { t } = useTranslation('myClass');
  const region = useRegionConfig();
  const query = useFeeDues({
    section_id: sectionId,
    sort_by: 'due_amount',
    sort_order: 'DESC',
    limit: DUES_PAGE,
  });
  const rows = query.data?.data ?? [];
  const total = rows.reduce((sum, r) => sum + Number(r.total_due), 0);
  return (
    <CardFrame
      id="my-class-dues"
      title={t('cards.dues')}
      state={{
        isPending: query.isPending,
        isError: query.isError,
        retry: () => void query.refetch(),
      }}
      empty={rows.length === 0 ? t('cardEmpty.dues') : undefined}
    >
      <p className="text-sm font-medium">
        {t('duesSummary', {
          total: formatServerAmount(total, region),
          count: query.data?.total ?? rows.length,
        })}
      </p>
      <ul className="flex flex-col">
        {rows.slice(0, ROWS).map((r) => (
          <Row
            key={r.student_id}
            left={r.full_name}
            right={formatServerAmount(r.total_due, region)}
          />
        ))}
      </ul>
      <Link className={SEE_ALL_CLASS} to="/fees/dues" search={{ section_id: sectionId }}>
        {t('seeAll')}
      </Link>
    </CardFrame>
  );
}

// --- 4. Homework ----------------------------------------------------------

export function HomeworkCard({ sectionId }: { sectionId: string }) {
  const { t } = useTranslation('myClass');
  const query = useSectionHomeworkRollup(sectionId);
  const data = query.data;
  return (
    <CardFrame
      id="my-class-homework"
      title={t('cards.homework')}
      state={{
        isPending: query.isPending,
        isError: query.isError,
        retry: () => void query.refetch(),
      }}
      empty={data && data.totalAssignments === 0 ? t('cardEmpty.homework') : undefined}
    >
      {data && (
        <ul className="flex flex-col">
          <Row left={t('homeworkCounts.total')} right={data.totalAssignments} />
          <Row left={t('homeworkCounts.completed')} right={data.completed} />
          <Row left={t('homeworkCounts.defaulters')} right={data.defaulters} />
        </ul>
      )}
    </CardFrame>
  );
}

// --- 5. Results -----------------------------------------------------------

export function ResultsCard({ sectionId, classId }: { sectionId: string; classId: string }) {
  const { t } = useTranslation('myClass');
  const exams = useExams({ class_id: classId, limit: 100 });
  // D23: the class's latest PUBLISHED exam. The list endpoint has no status
  // filter, so pick it here.
  const exam = (exams.data?.data ?? [])
    .filter((e) => e.status === 'PUBLISHED')
    .sort((a, b) => (b.published_at ?? '').localeCompare(a.published_at ?? ''))[0];
  const perf = useQuery({
    ...classPerformanceQueryOptions(classId, {
      academicYearId: exam?.academic_year_id ?? '',
      sectionId,
    }),
    enabled: exam !== undefined,
  });
  const defaulted = useDefaultedList(exam?.id, sectionId);

  const outcome = perf.data?.exams.find((e) => e.examId === exam?.id);
  const failed = (defaulted.data?.rows ?? []).filter((r) => r.is_fail);
  const noExam = !exams.isPending && !exams.isError && exam === undefined;
  return (
    <CardFrame
      id="my-class-results"
      title={t('cards.results')}
      state={{
        isPending:
          exams.isPending || (exam !== undefined && (perf.isPending || defaulted.isPending)),
        isError: exams.isError || perf.isError || defaulted.isError,
        retry: () => {
          if (exams.isError) void exams.refetch();
          if (perf.isError) void perf.refetch();
          if (defaulted.isError) void defaulted.refetch();
        },
      }}
      empty={noExam ? t('cardEmpty.results') : undefined}
    >
      <p className="text-sm font-medium">{exam?.name}</p>
      <ul className="flex flex-col">
        <Row left={t('resultsSummary.average')} right={outcome?.averageMarks ?? '—'} />
        <Row
          left={t('resultsSummary.passRate')}
          right={outcome ? `${Math.round(outcome.passRate)}%` : '—'}
        />
      </ul>
      {failed.length > 0 && (
        <div className="flex flex-col">
          <h3 className="text-sm font-medium">{t('resultsSummary.failed')}</h3>
          <ul className="flex flex-col">
            {failed.slice(0, ROWS).map((r) => (
              <Row
                key={r.student_id}
                left={r.full_name}
                right={t('roll', { roll: r.roll_number })}
              />
            ))}
          </ul>
        </div>
      )}
    </CardFrame>
  );
}

// --- 6. Roster ------------------------------------------------------------

export function RosterCard({ sectionId }: { sectionId: string }) {
  const { t } = useTranslation('myClass');
  const query = useStudents({ section_id: sectionId, sort: 'full_name', limit: ROWS });
  const students = query.data?.data ?? [];
  return (
    <CardFrame
      id="my-class-roster"
      title={t('cards.roster')}
      state={{
        isPending: query.isPending,
        isError: query.isError,
        retry: () => void query.refetch(),
      }}
      empty={students.length === 0 ? t('cardEmpty.roster') : undefined}
    >
      <ul className="flex flex-col">
        {students.map((s) => {
          const guardian = s.guardians.find((g) => g.is_primary_contact) ?? s.guardians[0];
          return (
            <Row
              key={s.id}
              left={`${t('roll', { roll: s.roll_number })} · ${s.full_name}`}
              right={
                guardian?.phone ? (
                  <a
                    href={`tel:${guardian.phone}`}
                    aria-label={t('callGuardian', { name: s.full_name })}
                    className="text-primary underline-offset-4 hover:underline"
                  >
                    {guardian.phone}
                  </a>
                ) : (
                  t('noPhone')
                )
              }
            />
          );
        })}
      </ul>
      {(query.data?.total ?? 0) > ROWS && (
        <Link className={SEE_ALL_CLASS} to="/students" search={{ section_id: sectionId }}>
          {t('seeAll')}
        </Link>
      )}
    </CardFrame>
  );
}

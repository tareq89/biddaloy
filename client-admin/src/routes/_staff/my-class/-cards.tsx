/**
 * [47.4.2] The six cards of `/my-class/$sectionId`, in D15 order. Every card
 * owns its own query, so each loads, fails and retries independently (D14):
 * one dead endpoint shows a retry inside that card and the rest still render.
 */
import { Permission } from '@biddaloy/shared';
import { Button, Card, Skeleton, StatusBadge } from '@biddaloy/ui/components';
import {
  classPerformanceQueryOptions,
  useAttendanceStreaks,
  useDefaultedList,
  useExams,
  useFeeDues,
  useHasPermission,
  useSectionHomeworkRollup,
  useSectionRegister,
  useStudents,
  type AttendanceStreak,
} from '@biddaloy/ui/hooks';
import { useRegionConfig, useTranslation } from '@biddaloy/ui/i18n';
import { formatNumber, formatPhone, formatServerAmount } from '@biddaloy/ui/utils';
import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { ChevronRightIcon, PhoneIcon, RotateCcwIcon } from 'lucide-react';
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
  badge,
  subtitle,
  children,
}: {
  id: string;
  title: string;
  state: CardState;
  /** Empty-line text; when set the body is replaced by it. */
  empty?: string | undefined;
  badge?: ReactNode;
  subtitle?: string | undefined;
  children?: ReactNode;
}) {
  const { t } = useTranslation('myClass');
  let body: ReactNode;
  if (state.isPending) {
    body = (
      <div className="flex flex-col gap-2" aria-hidden="true">
        <Skeleton className="h-3 w-2/3" />
        <Skeleton className="h-3 w-1/2" />
      </div>
    );
  } else if (state.isError) {
    body = (
      <div role="alert" className="flex flex-col items-start gap-2">
        <p className="text-text-secondary">{t('cardError')}</p>
        <Button variant="outline" onClick={state.retry}>
          <RotateCcwIcon aria-hidden="true" />
          {t('retry')}
        </Button>
      </div>
    );
  } else if (empty !== undefined) {
    body = <p className="text-text-secondary">{empty}</p>;
  } else {
    body = children;
  }
  return (
    <Card asChild padded>
      <section aria-labelledby={id}>
        <div className="flex items-center justify-between gap-3">
          <h2 id={id} className="text-h2">
            {title}
          </h2>
          {badge}
        </div>
        {subtitle && <p className="mt-1 text-text-secondary">{subtitle}</p>}
        <div className="mt-3">{body}</div>
      </section>
    </Card>
  );
}

const SEE_ALL_CLASS =
  '-ms-2 mt-2 inline-flex h-11 items-center gap-1 rounded-md px-2 font-medium text-primary no-underline hover:bg-muted md:h-8';

const SEE_ALL_ICON = <ChevronRightIcon className="size-4" aria-hidden="true" />;

function List({ children }: { children: ReactNode }) {
  return <ul className="divide-y divide-border-subtle">{children}</ul>;
}

function Row({ left, right }: { left: ReactNode; right?: ReactNode }) {
  return (
    <li className="flex items-center justify-between gap-3 py-2">
      <span className="min-w-0">{left}</span>
      {right !== undefined && (
        <span className="shrink-0 text-end text-text-secondary tabular-nums">{right}</span>
      )}
    </li>
  );
}

function Name({ children }: { children: ReactNode }) {
  return <span className="block truncate font-medium">{children}</span>;
}

function RollLine({ roll }: { roll: number | string | null | undefined }) {
  const { t } = useTranslation('myClass');
  const region = useRegionConfig();
  return (
    <span className="block text-caption text-text-secondary">
      {t('roll', { roll: formatNumber(Number(roll), region) })}
    </span>
  );
}

function Stats({ items }: { items: { label: string; value: string; tone?: string }[] }) {
  return (
    <dl className={`grid gap-4 ${items.length === 3 ? 'grid-cols-3' : 'grid-cols-2'}`}>
      {items.map((i) => (
        <div key={i.label}>
          <dt className="text-caption text-text-secondary">{i.label}</dt>
          <dd className={`text-h2 tabular-nums ${i.tone ?? ''}`}>{i.value}</dd>
        </div>
      ))}
    </dl>
  );
}

// --- 1. Today's absentees -------------------------------------------------

export function AbsenteesCard({ sectionId }: { sectionId: string }) {
  const { t } = useTranslation('myClass');
  const region = useRegionConfig();
  const query = useSectionRegister(sectionId, todayIso());
  const students = query.data?.students ?? [];
  const absent = students.filter((s) => s.status === 'ABSENT');
  // Every status null = nobody has marked today's register yet; "no one is
  // absent" would be a false all-clear.
  const notTaken = students.length > 0 && students.every((s) => s.status === null);
  let badge: ReactNode;
  if (notTaken) badge = <StatusBadge tone="warning" label={t('notTakenBadge')} />;
  else if (absent.length > 0)
    badge = (
      <StatusBadge
        tone="danger"
        label={t('absentCount', {
          count: absent.length,
          n: formatNumber(absent.length, region),
        })}
      />
    );
  return (
    <CardFrame
      id="my-class-absentees"
      title={t('cards.absentees')}
      badge={query.isPending || query.isError ? undefined : badge}
      state={{
        isPending: query.isPending,
        isError: query.isError,
        retry: () => void query.refetch(),
      }}
      empty={
        notTaken
          ? t('cardEmpty.attendanceNotTaken')
          : absent.length === 0
            ? t('cardEmpty.absentees')
            : undefined
      }
    >
      <List>
        {absent.slice(0, ROWS).map((s) => (
          <Row
            key={s.student_id}
            left={<Name>{s.full_name}</Name>}
            right={t('roll', { roll: formatNumber(s.roll_number, region) })}
          />
        ))}
      </List>
      {absent.length > ROWS && (
        <Link
          className={SEE_ALL_CLASS}
          to="/attendance/$sectionId"
          params={{ sectionId }}
          search={{ date: todayIso() }}
        >
          {t('seeAll')}
          {SEE_ALL_ICON}
        </Link>
      )}
    </CardFrame>
  );
}

// --- 2. Attendance flags --------------------------------------------------

const FLAG_GROUPS = ['ABSENT', 'LATE', 'PRESENT'] as const;
const FLAG_TONE = { ABSENT: 'danger', LATE: 'warning', PRESENT: 'success' } as const;

export function FlagsCard({ sectionId }: { sectionId: string }) {
  const { t } = useTranslation('myClass');
  const region = useRegionConfig();
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
          <div key={status}>
            <h3 className="mt-3 text-label text-text-secondary first:mt-0">
              {t(`flagGroups.${status}`)}
            </h3>
            <List>
              {group.map((i) => (
                <Row
                  key={i.student_id}
                  left={
                    <>
                      <Name>{i.student_name}</Name>
                      <RollLine roll={i.roll_number} />
                    </>
                  }
                  right={
                    <StatusBadge
                      tone={FLAG_TONE[i.status]}
                      label={t('flagDays', {
                        count: i.length,
                        n: formatNumber(i.length, region),
                      })}
                    />
                  }
                />
              ))}
            </List>
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
  // `/fees/dues` needs FEE_COLLECT; a TEACHER only has FEE_READ, so the link
  // would land on access-denied.
  const canOpenDues = useHasPermission(Permission.FEE_COLLECT);
  const query = useFeeDues({
    section_id: sectionId,
    sort_by: 'due_amount',
    sort_order: 'DESC',
    limit: DUES_PAGE,
  });
  const rows = query.data?.data ?? [];
  const total = rows.reduce((sum, r) => sum + Number(r.total_due), 0);
  const n = query.data?.total ?? rows.length;
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
      <Stats
        items={[
          { label: t('duesTotal'), value: formatServerAmount(total, region) },
          {
            label: t('duesStudents'),
            value: t('studentCount', { count: n, n: formatNumber(n, region) }),
          },
        ]}
      />
      <div className="mt-3 border-t border-border-subtle">
        <List>
          {rows.slice(0, ROWS).map((r) => (
            <Row
              key={r.student_id}
              left={<Name>{r.full_name}</Name>}
              right={
                <span className="text-text-primary">{formatServerAmount(r.total_due, region)}</span>
              }
            />
          ))}
        </List>
      </div>
      {canOpenDues && (
        <Link className={SEE_ALL_CLASS} to="/fees/dues" search={{ section_id: sectionId }}>
          {t('seeAll')}
          {SEE_ALL_ICON}
        </Link>
      )}
    </CardFrame>
  );
}

// --- 4. Homework ----------------------------------------------------------

export function HomeworkCard({ sectionId }: { sectionId: string }) {
  const { t } = useTranslation('myClass');
  const region = useRegionConfig();
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
        <Stats
          items={[
            {
              label: t('homeworkCounts.total'),
              value: formatNumber(data.totalAssignments, region),
            },
            { label: t('homeworkCounts.completed'), value: formatNumber(data.completed, region) },
            {
              label: t('homeworkCounts.defaulters'),
              value: formatNumber(data.defaulters, region),
              ...(data.defaulters > 0 ? { tone: 'text-status-overdue-fg' } : {}),
            },
          ]}
        />
      )}
    </CardFrame>
  );
}

// --- 5. Results -----------------------------------------------------------

export function ResultsCard({ sectionId, classId }: { sectionId: string; classId: string }) {
  const { t } = useTranslation('myClass');
  const region = useRegionConfig();
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
      subtitle={exam?.name}
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
      <Stats
        items={[
          {
            label: t('resultsSummary.average'),
            value:
              outcome?.averageMarks != null
                ? formatNumber(outcome.averageMarks, region, { decimals: 1 })
                : '—',
          },
          {
            label: t('resultsSummary.passRate'),
            value:
              outcome?.passRate != null
                ? `${formatNumber(Math.round(outcome.passRate), region)}%`
                : '—',
          },
        ]}
      />
      {failed.length > 0 && (
        <div>
          <h3 className="mt-4 text-label text-text-secondary">{t('resultsSummary.failed')}</h3>
          <List>
            {failed.slice(0, ROWS).map((r) => (
              <Row
                key={r.student_id}
                left={<Name>{r.full_name}</Name>}
                right={t('roll', { roll: formatNumber(r.roll_number, region) })}
              />
            ))}
          </List>
        </div>
      )}
    </CardFrame>
  );
}

// --- 6. Roster ------------------------------------------------------------

export function RosterCard({ sectionId }: { sectionId: string }) {
  const { t } = useTranslation('myClass');
  const region = useRegionConfig();
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
      <List>
        {students.map((s) => {
          const guardian = s.guardians.find((g) => g.is_primary_contact) ?? s.guardians[0];
          return (
            <li key={s.id} className="flex items-center justify-between gap-3 py-1">
              <span className="min-w-0">
                <Name>{s.full_name}</Name>
                <RollLine roll={s.roll_number} />
              </span>
              {guardian?.phone ? (
                <a
                  href={`tel:${guardian.phone}`}
                  aria-label={t('callGuardian', { name: s.full_name })}
                  className="-me-2 inline-flex h-11 shrink-0 items-center gap-1.5 rounded-md px-2 font-medium text-primary no-underline hover:bg-muted md:h-8"
                >
                  <PhoneIcon className="size-4" aria-hidden="true" />
                  {formatPhone(guardian.phone, region)}
                </a>
              ) : (
                <span className="flex h-11 items-center text-text-secondary md:h-8">
                  {t('noPhone')}
                </span>
              )}
            </li>
          );
        })}
      </List>
      {(query.data?.total ?? 0) > ROWS && (
        <Link className={SEE_ALL_CLASS} to="/students" search={{ section_id: sectionId }}>
          {t('seeAll')}
          {SEE_ALL_ICON}
        </Link>
      )}
    </CardFrame>
  );
}

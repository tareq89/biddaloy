/**
 * [9.6] "Which section do I mark today?" — every section the signed-in
 * teacher is mapped to (`GET /attendance/my-sections`, server-scoped —
 * see the plan's "Plan corrections" on why this is not a client-side
 * filter over the tenant's whole class/section list).
 *
 * Whole row links to `/attendance/$sectionId`; today's mark state renders
 * as a small pill built from the same `status-*` design tokens
 * `StatusBadge` uses elsewhere (not routed through `StatusBadge` itself —
 * its `domain`/`status` API renders a static, translated label per
 * status, and "Marked 39/42" needs a live count baked into the label,
 * which that API does not express).
 */
import { ApiError } from '@biddaloy/ui/api';
import { EmptyState, ErrorState, RoutePending, Skeleton } from '@biddaloy/ui/components';
import { mySectionsQueryOptions, useMySections, type MySection } from '@biddaloy/ui/hooks';
import { useTranslation } from '@biddaloy/ui/i18n';
import { createFileRoute, Link, useNavigate } from '@tanstack/react-router';

import { loadRouteNamespaces, swallowUnlessOffline } from '../../../route-loaders';

// `.toISOString()` is UTC — a teacher in Asia/Dhaka (UTC+6) opening this
// list between 00:00 and 06:00 local time would get UTC's *previous*
// calendar day, linking to yesterday's register while `TodayPill` still
// shows the server-computed state for today. Local getters, matching
// `register.tsx`/`reports.tsx`'s own `currentMonthIso()`.
function todayIso(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

export const Route = createFileRoute('/_staff/attendance/')({
  loader: ({ context: { queryClient } }) =>
    Promise.all([
      queryClient.ensureQueryData(mySectionsQueryOptions()).catch(swallowUnlessOffline),
      loadRouteNamespaces('attendance'),
    ]),
  pendingComponent: AttendanceListPending,
  component: AttendanceListPage,
});

function todayTone(section: MySection): 'success' | 'warning' | 'neutral' {
  if (!section.today) return 'neutral';
  return section.today.state === 'FINALIZED' ? 'success' : 'warning';
}

const TONE_CLASSES: Record<'success' | 'warning' | 'neutral', string> = {
  success: 'text-status-paid-fg bg-status-paid-bg',
  warning: 'text-status-due-fg bg-status-due-bg',
  neutral: 'text-muted-foreground bg-muted',
};

function TodayPill({ section }: { section: MySection }) {
  const { t } = useTranslation('attendance');
  const tone = todayTone(section);
  const label = !section.today
    ? t('list.notMarked')
    : section.today.state === 'FINALIZED'
      ? t('list.marked', {
          present: section.today.present + section.today.late,
          total:
            section.today.present + section.today.absent + section.today.late + section.today.leave,
        })
      : t('list.draft');
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${TONE_CLASSES[tone]}`}
    >
      {label}
    </span>
  );
}

function AttendanceListPage() {
  const { t } = useTranslation('attendance');
  const query = useMySections();
  const navigate = useNavigate();

  if (query.isPending) {
    return (
      <div className="flex flex-col gap-2 p-4" aria-hidden="true">
        <Skeleton className="h-14 w-full" />
        <Skeleton className="h-14 w-full" />
        <Skeleton className="h-14 w-full" />
      </div>
    );
  }

  if (query.isError) {
    const forbidden = query.error instanceof ApiError && query.error.statusCode === 403;
    return (
      <div className="p-4">
        <ErrorState
          message={forbidden ? t('list.forbidden') : t('list.errorMessage')}
          retryLabel={t('list.retry')}
          onRetry={() => void query.refetch()}
        />
      </div>
    );
  }

  const sections = query.data ?? [];

  if (sections.length === 0) {
    return (
      <div className="p-4">
        <EmptyState
          title={t('list.emptyTitle')}
          explanation={t('list.emptyExplanation')}
          action={{
            label: t('list.emptyAction'),
            onClick: () => void navigate({ to: '/dashboard' }),
          }}
        />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3 p-4">
      <h1 className="text-lg font-semibold">{t('list.title')}</h1>
      <ul className="flex flex-col gap-2">
        {sections.map((section) => (
          <li key={section.section_id}>
            <Link
              to="/attendance/$sectionId"
              params={{ sectionId: section.section_id }}
              search={{ date: todayIso() }}
              className="flex min-h-14 items-center justify-between gap-3 rounded-lg border border-border-subtle bg-card px-4 py-2 no-underline hover:bg-muted"
            >
              <span className="flex flex-col">
                <span className="font-medium">
                  {section.class_name} {section.section_name}
                </span>
                <span className="text-sm text-muted-foreground">
                  {t('list.columnStudents')}: {section.student_count}
                </span>
              </span>
              <TodayPill section={section} />
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}

function AttendanceListPending() {
  return <RoutePending variant="list" label="Loading" />;
}

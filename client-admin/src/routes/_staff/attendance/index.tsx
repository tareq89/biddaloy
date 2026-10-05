/**
 * [9.6] "Which section do I mark today?" — every section the signed-in
 * teacher is mapped to (`GET /attendance/my-sections`, server-scoped —
 * see the plan's "Plan corrections" on why this is not a client-side
 * filter over the tenant's whole class/section list).
 *
 * Each section is a link card to `/attendance/$sectionId`; unfinished
 * sections (not marked, then draft) sort before submitted ones.
 */
import { ApiError } from '@biddaloy/ui/api';
import {
  EmptyState,
  ErrorState,
  RoutePending,
  Skeleton,
  StatusBadge,
} from '@biddaloy/ui/components';
import { mySectionsQueryOptions, useMySections, type MySection } from '@biddaloy/ui/hooks';
import { useTenantRegionConfig, useTranslation } from '@biddaloy/ui/i18n';
import { PageContainer, PageHeader } from '@biddaloy/ui/shells';
import { formatDate } from '@biddaloy/ui/utils';
import { createFileRoute, Link, useNavigate } from '@tanstack/react-router';
import { CalendarCheck2, ChevronRight } from 'lucide-react';

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

function rank(section: MySection): number {
  if (!section.today) return 0;
  return section.today.state === 'FINALIZED' ? 2 : 1;
}

function TodayBadge({ section }: { section: MySection }) {
  const { t } = useTranslation('attendance');
  const today = section.today;
  if (!today) return <StatusBadge tone="warning" label={t('list.notMarked')} />;
  if (today.state !== 'FINALIZED') return <StatusBadge tone="info" label={t('list.draft')} />;
  return (
    <StatusBadge
      tone="success"
      label={t('list.marked', {
        present: today.present + today.late,
        total: today.present + today.absent + today.late + today.leave,
      })}
    />
  );
}

function AttendanceListPage() {
  const { t } = useTranslation('attendance');
  const regionConfig = useTenantRegionConfig();
  const query = useMySections();
  const navigate = useNavigate();

  if (query.isPending) {
    return (
      <PageContainer>
        <div aria-busy="true" className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          <span className="sr-only">{t('list.loadingLabel')}</span>
          <Skeleton className="h-20 rounded-lg" />
          <Skeleton className="h-20 rounded-lg" />
          <Skeleton className="h-20 rounded-lg" />
        </div>
      </PageContainer>
    );
  }

  if (query.isError) {
    const forbidden = query.error instanceof ApiError && query.error.statusCode === 403;
    return (
      <PageContainer>
        <ErrorState
          message={forbidden ? t('list.forbidden') : t('list.errorMessage')}
          retryLabel={t('list.retry')}
          onRetry={() => void query.refetch()}
        />
      </PageContainer>
    );
  }

  const sections = query.data ?? [];

  if (sections.length === 0) {
    return (
      <PageContainer>
        <EmptyState
          icon={<CalendarCheck2 />}
          title={t('list.emptyTitle')}
          explanation={t('list.emptyExplanation')}
          action={{
            label: t('list.emptyAction'),
            onClick: () => void navigate({ to: '/dashboard' }),
          }}
        />
      </PageContainer>
    );
  }

  const today = todayIso();
  const pending = sections.filter((s) => s.today?.state !== 'FINALIZED').length;
  const date = formatDate(today, regionConfig);
  // Array.prototype.sort is stable: server order is kept within a group.
  const sorted = [...sections].sort((a, b) => rank(a) - rank(b));

  return (
    <PageContainer>
      <PageHeader
        title={t('list.title')}
        subtitle={
          pending > 0
            ? t('list.subtitle', { date, count: pending })
            : t('list.subtitleDone', { date })
        }
      />
      <section aria-labelledby="att-sections">
        <h2 id="att-sections" className="sr-only">
          {t('list.caption')}
        </h2>
        <ul className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {sorted.map((section) => (
            <li key={section.section_id}>
              <Link
                to="/attendance/$sectionId"
                params={{ sectionId: section.section_id }}
                search={{ date: today }}
                className="flex min-h-16 items-center gap-3 rounded-lg border border-border-subtle bg-surface p-4 no-underline shadow-e1 hover:bg-muted md:p-5"
              >
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-h3">
                    {t('mark.title', {
                      className: section.class_name,
                      sectionName: section.section_name,
                    })}
                  </span>
                  <span className="mt-0.5 block text-text-secondary">
                    {t('list.studentCount', { count: section.student_count })}
                  </span>
                </span>
                <TodayBadge section={section} />
                <ChevronRight aria-hidden className="size-4 shrink-0 text-text-secondary" />
              </Link>
            </li>
          ))}
        </ul>
      </section>
    </PageContainer>
  );
}

function AttendanceListPending() {
  const { t } = useTranslation('attendance');
  return <RoutePending variant="list" label={t('list.loadingLabel')} />;
}

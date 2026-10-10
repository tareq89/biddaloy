import {
  Button,
  Card,
  EmptyState,
  ErrorState,
  Pagination,
  RoutePending,
  Skeleton,
  StatusBadge,
  StudentPicker,
} from '@biddaloy/ui/components';
import {
  APPLICATION_STATUS_TONE,
  myStudentsQueryOptions,
  stepLabel,
  useApplications,
  useCurrentUserId,
  useMyStudents,
  type ApplicationListItemDto,
  type Student,
} from '@biddaloy/ui/hooks';
import { RegionConfigProvider, useRegionConfig, useTranslation } from '@biddaloy/ui/i18n';
import { PageContainer, PageHeader } from '@biddaloy/ui/shells';
import { formatDate, formatNumber } from '@biddaloy/ui/utils';
import { createFileRoute, Link, useNavigate } from '@tanstack/react-router';
import { z } from 'zod';

import { loadRouteNamespaces, swallowUnlessOffline } from '../../../route-loaders';
import { summarize } from '../../_staff/applications/-list/application-summary';

const PAGE_SIZE = 25;

/** [52.6.1] The chosen child and the page. No filters yet; add their keys with the filters. */
const portalApplicationsSearchSchema = z.object({
  student: z.string().optional().catch(undefined),
  page: z.number().int().positive().optional().catch(undefined),
});

export const Route = createFileRoute('/portal/applications/')({
  validateSearch: portalApplicationsSearchSchema,
  loader: ({ context: { queryClient } }) =>
    Promise.all([
      queryClient.ensureQueryData(myStudentsQueryOptions()).catch(swallowUnlessOffline),
      loadRouteNamespaces(
        'portalApplications',
        'portal',
        'applications',
        'applicationsList',
        'applicationForms',
        'leave',
        'feeStructures',
        'common',
      ),
    ]),
  pendingComponent: PortalApplicationsPending,
  component: PortalApplicationsRoute,
});

function PortalApplicationsRoute() {
  return (
    <RegionConfigProvider>
      <PortalApplications />
    </RegionConfigProvider>
  );
}

function PortalApplications() {
  const { t } = useTranslation('portalApplications');
  const { t: tPortal } = useTranslation('portal');
  const config = useRegionConfig();
  const search = Route.useSearch();
  const navigate = useNavigate();
  const page = search.page ?? 1;

  const studentsQuery = useMyStudents();
  const students: Student[] = studentsQuery.data ?? [];
  const selected = students.find((s) => s.id === search.student) ?? students[0] ?? undefined;

  const studentMeta = (student: Student) => {
    const className = student.class_section?.class?.name ?? null;
    const roll = formatNumber(student.roll_number, config);
    return className === null
      ? tPortal('children.metaNoClass', { roll })
      : tPortal('children.meta', {
          className,
          section: student.class_section?.section_name ?? '',
          roll,
        });
  };

  // `view: 'mine'` already holds everything about a linked child, whoever filed it (D43). Not
  // asked until a child is known: without `student_id` the answer would only be thrown away.
  const listQuery = useApplications(
    { view: 'mine', ...(selected && { student_id: selected.id }), page, limit: PAGE_SIZE },
    { enabled: selected !== undefined },
  );

  // Same frame as the empty state, so a failed load still has its <h1>.
  const failed = (onRetry: () => void) => (
    <PageContainer size="narrow">
      <PageHeader title={t('title')} />
      <ErrorState message={t('error.message')} retryLabel={t('error.retry')} onRetry={onRetry} />
    </PageContainer>
  );

  if (studentsQuery.isPending) return <ListSkeleton label={t('loading')} />;
  if (studentsQuery.isError) return failed(() => void studentsQuery.refetch());
  if (students.length === 0 || selected === undefined) {
    return (
      <PageContainer size="narrow">
        <PageHeader title={t('title')} />
        <EmptyState
          title={tPortal('empty.title')}
          explanation={tPortal('empty.explanation')}
          action={{ label: tPortal('empty.action'), onClick: () => void studentsQuery.refetch() }}
        />
      </PageContainer>
    );
  }

  // A real link with `?student=`: `PageHeader`'s `to` action takes a bare path, not a search.
  const header = (
    <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
      <PageHeader
        title={t('title')}
        subtitle={`${selected.full_name} · ${studentMeta(selected)}`}
      />
      <Button asChild className="md:shrink-0">
        <Link to="/portal/applications/new" search={{ student: selected.id }}>
          {t('newApplication')}
        </Link>
      </Button>
    </div>
  );
  const picker = students.length > 1 && (
    <StudentPicker
      label={tPortal('fees.pickerLabel')}
      items={students.map((s) => ({ id: s.id, name: s.full_name, meta: studentMeta(s) }))}
      selectedId={selected.id}
      to="/portal/applications"
    />
  );

  if (listQuery.isPending) return <ListSkeleton label={t('loading')} showPicker={!!picker} />;
  if (listQuery.isError) return failed(() => void listQuery.refetch());

  const { data: rows, total } = listQuery.data;
  return (
    <PageContainer size="narrow">
      {header}
      {picker}
      {rows.length === 0 ? (
        <EmptyState
          title={t('empty.title')}
          explanation={t('empty.explanation')}
          action={{
            label: t('newApplication'),
            onClick: () =>
              void navigate({ to: '/portal/applications/new', search: { student: selected.id } }),
          }}
        />
      ) : (
        <ul className="grid gap-3 lg:grid-cols-2">
          {rows.map((row) => (
            <li key={row.id}>
              <ApplicationCard row={row} />
            </li>
          ))}
        </ul>
      )}
      {total > PAGE_SIZE && (
        <Pagination
          page={page}
          pageSize={PAGE_SIZE}
          totalCount={total}
          previousLabel={t('pager.previous')}
          nextLabel={t('pager.next')}
          onPageChange={(next) =>
            void navigate({ to: '.', search: (prev) => ({ ...prev, page: next }) })
          }
        />
      )}
    </PageContainer>
  );
}

function ApplicationCard({ row }: { row: ApplicationListItemDto }) {
  const { t } = useTranslation('portalApplications');
  const { t: tApp } = useTranslation('applications');
  const config = useRegionConfig();
  const me = useCurrentUserId();
  const open = row.status === 'PENDING' || row.status === 'UNDER_CONSIDERATION';
  const translate = (key: string, options?: Record<string, unknown>) =>
    tApp(key, options as never) as unknown as string;
  const filedBy =
    row.source === 'PAPER'
      ? t('filed.paper')
      : row.applicant_user_id !== null && row.applicant_user_id === me
        ? t('filed.self')
        : t('filed.other', { name: row.applicant_name });
  return (
    <Card asChild padded className="block min-h-11 hover:bg-muted">
      <Link to="/portal/applications/$applicationId" params={{ applicationId: row.id }}>
        <div className="flex items-start justify-between gap-2">
          <h2 className="text-h3">{tApp(`types.${row.type}`)}</h2>
          <StatusBadge
            tone={APPLICATION_STATUS_TONE[row.status]}
            label={tApp(`statuses.${row.status}`)}
          />
        </div>
        <p className="mt-1">{summarize(row, translate, config)}</p>
        {(open || row.decided_at) && (
          <p className="mt-1 text-text-secondary">
            {open
              ? t('state.open', { step: stepLabel(row, translate, config) })
              : t('state.decided', { date: formatDate(row.decided_at, config) })}
          </p>
        )}
        <p className="mt-2 text-caption text-text-secondary">
          <span dir="ltr">{row.serial}</span> ·{' '}
          {t('filed.date', { date: formatDate(row.created_at, config) })} · {filedBy}
        </p>
      </Link>
    </Card>
  );
}

function ListSkeleton({ label, showPicker = false }: { label: string; showPicker?: boolean }) {
  return (
    <div className="flex flex-col gap-3" aria-busy="true" aria-live="polite">
      <span className="sr-only">{label}</span>
      <Skeleton className="h-8 w-2/5" />
      {showPicker && <Skeleton className="h-12 w-full rounded-lg" />}
      <Skeleton className="h-28 w-full rounded-lg" />
      <Skeleton className="h-28 w-full rounded-lg" />
    </div>
  );
}

function PortalApplicationsPending() {
  const { t } = useTranslation('nav');
  return <RoutePending variant="list" label={t('routePending.label', { ns: 'nav' })} />;
}

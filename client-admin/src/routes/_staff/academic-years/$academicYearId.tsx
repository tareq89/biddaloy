import { Permission } from '@biddaloy/shared';
import { ApiError, isNotFoundError } from '@biddaloy/ui/api';
import {
  ConfirmDialog,
  ErrorState,
  RecordNotFoundState,
  RoutePending,
  Skeleton,
  StatusBadge,
} from '@biddaloy/ui/components';
import {
  academicYearQueryOptions,
  useAcademicYear,
  useAcademicYearStats,
  useHasPermission,
  useReopenYear,
  useUpdateAcademicYear,
} from '@biddaloy/ui/hooks';
import { RegionConfigProvider, useTenantRegionConfig, useTranslation } from '@biddaloy/ui/i18n';
import { DetailShell, useDetailShellTab } from '@biddaloy/ui/shells';
import { formatDate, formatDateRange, parseServerDate } from '@biddaloy/ui/utils';
import { createFileRoute, useNavigate } from '@tanstack/react-router';
import {
  CalendarPlusIcon,
  CircleCheckIcon,
  LockIcon,
  LockOpenIcon,
  PencilIcon,
  Trash2Icon,
} from 'lucide-react';
import * as React from 'react';

import { loadRouteNamespaces, swallowUnlessOffline } from '../../../route-loaders';

import { CloseYearDialog } from './-close-year-dialog';
import { DeleteYearDialog } from './-delete-year-dialog';
import { ClassesTab } from './-detail/classes-tab';
import { FeeStructuresTab } from './-detail/fee-structures-tab';
import { TermsTab } from './-detail/terms-tab';
import { SetCurrentDialog } from './-set-current-dialog';
import { YearFormDialog, type YearFormPayload } from './-year-form-dialog';

export const Route = createFileRoute('/_staff/academic-years/$academicYearId')({
  loader: ({ context: { queryClient }, params }) =>
    Promise.all([
      // [8.14.5]: `.catch(swallowUnlessOffline)` — a loader rejection would
      // otherwise hand this route to the router's generic error boundary
      // before the component (and its own `ErrorState`/403 handling)
      // ever mounts. Swallowing here just means "the loader didn't warm
      // the cache"; `useAcademicYear` runs the same query again and
      // surfaces the failure through the page's own error UI, exactly
      // as it did before this route had a loader at all.
      queryClient
        .ensureQueryData(academicYearQueryOptions(params.academicYearId))
        .catch(swallowUnlessOffline),
      // 'feeStructures' — `-detail/fee-structures-tab.tsx` reads its copy
      // from that namespace; without this, the first visit to it suspends
      // the whole page (i18n's useSuspense: true) instead of just that
      // tab, taking keyboard focus with it — same failure mode
      // `students/$studentId.tsx`'s loader comment documents.
      loadRouteNamespaces('academicYears', 'common', 'feeStructures'),
    ]),
  pendingComponent: AcademicYearDetailPending,
  component: AcademicYearDetailPage,
});

const TAB_IDS = ['classes', 'feeStructures', 'terms'] as const;

function AcademicYearDetailPage() {
  const { academicYearId } = Route.useParams();
  const { t } = useTranslation('academicYears');
  const { t: tCommon } = useTranslation('common');
  // `useRegionConfig()` has no ambient provider above the route tree, so
  // without this every date/count on this page would silently fall back
  // to the context's hardcoded default region rather than the active
  // tenant's actual one — same reasoning `students/$studentId.tsx`'s own
  // `RegionConfigProvider` wrap documents.
  const regionConfig = useTenantRegionConfig();
  const navigate = useNavigate();

  const yearQuery = useAcademicYear(academicYearId);
  const stats = useAcademicYearStats(academicYearId);
  const [activeTab, setActiveTab] = useDetailShellTab(TAB_IDS);
  const canManage = useHasPermission(Permission.ACADEMIC_YEAR_MANAGE);
  const canReadCalendar = useHasPermission(Permission.CALENDAR_READ);

  const updateYear = useUpdateAcademicYear(academicYearId);
  const [editOpen, setEditOpen] = React.useState(false);
  const [deleteOpen, setDeleteOpen] = React.useState(false);
  const [setCurrentOpen, setSetCurrentOpen] = React.useState(false);
  const [closeOpen, setCloseOpen] = React.useState(false);
  const [reopenOpen, setReopenOpen] = React.useState(false);
  const reopenYear = useReopenYear();

  if (yearQuery.isPending) {
    return (
      <div className="flex flex-col gap-2" aria-hidden="true">
        <Skeleton className="h-8 w-1/3" />
        <Skeleton className="h-40 w-full" />
      </div>
    );
  }

  if (isNotFoundError(yearQuery.error)) {
    return <RecordNotFoundState onBack={() => void navigate({ to: '/academic-years' })} />;
  }

  if (yearQuery.isError) {
    const forbidden = yearQuery.error instanceof ApiError && yearQuery.error.statusCode === 403;
    return (
      <ErrorState
        message={forbidden ? t('detail.forbidden') : t('list.errorMessage')}
        retryLabel={tCommon('actions.retry')}
        onRetry={() => void yearQuery.refetch()}
      />
    );
  }

  const year = yearQuery.data;

  function openEdit() {
    updateYear.reset();
    setEditOpen(true);
  }

  function handleUpdate(payload: YearFormPayload) {
    updateYear.mutate(payload, { onSuccess: () => setEditOpen(false) });
  }

  /** A count fact: skeleton while the stats load, an em dash if they failed. */
  function count(n: number | undefined, key: string) {
    if (stats.isPending) return <Skeleton className="h-4 w-10" />;
    if (n === undefined) {
      return (
        <>
          <span aria-hidden="true">—</span>
          <span className="sr-only">{t('detail.statsUnavailable')}</span>
        </>
      );
    }
    return t(key, { count: n });
  }

  return (
    <RegionConfigProvider value={regionConfig}>
      <DetailShell
        name={year.name}
        facts={[
          {
            label: t('detail.factPeriod'),
            value: formatDateRange(year.start_date, year.end_date, regionConfig),
          },
          {
            label: t('detail.statistics.classes'),
            value: count(stats.data?.classes_count, 'detail.classCount'),
          },
          {
            label: t('detail.statistics.students'),
            value: count(stats.data?.students_count, 'detail.studentCount'),
          },
          {
            label: t('detail.statistics.feeStructures'),
            value: count(stats.data?.fee_structures_count, 'detail.feeStructureCount'),
          },
        ]}
        statusBadge={
          <span className="inline-flex flex-wrap items-center gap-2">
            <StatusBadge
              domain="academicYear"
              status={year.is_current ? 'CURRENT' : 'NOT_CURRENT'}
            />
            {year.closed_at && (
              <StatusBadge
                tone="neutral"
                label={t('closeYear.closedOn', {
                  date: formatDate(year.closed_at, regionConfig),
                })}
              />
            )}
          </span>
        }
        actions={[
          {
            id: 'edit',
            helpId: 'academics.academicYears.action.edit',
            label: t('list.edit'),
            icon: <PencilIcon />,
            onClick: openEdit,
            allowed: canManage,
            priority: 'primary',
          },
          {
            id: 'set-current',
            helpId: 'academics.academicYears.action.setCurrent',
            label: t('list.setCurrent'),
            icon: <CircleCheckIcon />,
            onClick: () => setSetCurrentOpen(true),
            allowed: canManage && !year.is_current,
            priority: 'secondary',
          },
          {
            id: 'next-year',
            label: t('nextYear.fromThisOne'),
            icon: <CalendarPlusIcon />,
            onClick: () =>
              void navigate({
                to: '/academic-years/$academicYearId/next',
                params: { academicYearId: year.id },
              }),
            allowed: canManage && year.closed_at === null,
            priority: 'secondary',
          },
          {
            id: 'close-year',
            label: t('closeYear.action'),
            icon: <LockIcon />,
            onClick: () => setCloseOpen(true),
            // A current year cannot be closed (the server answers 409 CANNOT_CLOSE_CURRENT_YEAR).
            allowed: canManage && year.closed_at === null && !year.is_current,
            priority: 'secondary',
          },
          {
            id: 'reopen-year',
            label: t('closeYear.reopenAction'),
            icon: <LockOpenIcon />,
            onClick: () => {
              reopenYear.reset();
              setReopenOpen(true);
            },
            allowed: canManage && year.closed_at !== null,
            priority: 'secondary',
          },
          {
            id: 'delete',
            label: t('list.delete'),
            icon: <Trash2Icon />,
            onClick: () => setDeleteOpen(true),
            // `tertiary`, not `destructive`: PageHeader keeps a lone destructive action inline as a
            // red button, but the design wants Delete under More actions (D29).
            priority: 'tertiary',
            allowed: canManage,
          },
        ]}
        tabs={[
          {
            id: 'classes',
            label: t('detail.tabClasses'),
            content: <ClassesTab academicYearId={year.id} />,
          },
          {
            id: 'feeStructures',
            label: t('detail.tabFeeStructures'),
            content: <FeeStructuresTab academicYearId={year.id} />,
          },
          ...(canReadCalendar
            ? [
                {
                  id: 'terms',
                  label: t('detail.tabTerms'),
                  content: <TermsTab academicYearId={year.id} />,
                },
              ]
            : []),
        ]}
        activeTab={activeTab}
        onTabChange={setActiveTab}
      />

      {/* Mounted only while open, so each open starts from fresh state. */}
      {canManage && editOpen && (
        <YearFormDialog
          open
          onOpenChange={setEditOpen}
          mode="edit"
          initialValues={{
            name: year.name,
            startDate: parseServerDate(year.start_date),
            endDate: parseServerDate(year.end_date),
            isCurrent: year.is_current,
          }}
          isPending={updateYear.isPending}
          isError={updateYear.isError}
          onSubmit={handleUpdate}
        />
      )}

      {canManage && (
        <DeleteYearDialog
          open={deleteOpen}
          onOpenChange={setDeleteOpen}
          academicYearId={year.id}
          academicYearName={year.name}
          onDeleted={() => void navigate({ to: '/academic-years' })}
        />
      )}

      {canManage && (
        <CloseYearDialog
          open={closeOpen}
          onOpenChange={setCloseOpen}
          academicYearId={year.id}
          academicYearName={year.name}
          onClosed={() => setCloseOpen(false)}
        />
      )}

      {canManage && (
        <ConfirmDialog
          open={reopenOpen}
          // A request in flight must not be abandoned by Esc / Cancel.
          onOpenChange={(next) => {
            if (!reopenYear.isPending) setReopenOpen(next);
          }}
          tone="default"
          title={t('closeYear.reopenTitle', { name: year.name })}
          description={
            reopenYear.isError
              ? `${t('closeYear.reopenDescription', { name: year.name })} ${t('closeYear.reopenError')}`
              : t('closeYear.reopenDescription', { name: year.name })
          }
          confirmLabel={t('closeYear.reopenConfirm')}
          busy={reopenYear.isPending}
          onConfirm={() => reopenYear.mutate(year.id, { onSuccess: () => setReopenOpen(false) })}
        />
      )}

      {canManage && (
        <SetCurrentDialog
          open={setCurrentOpen}
          onOpenChange={setSetCurrentOpen}
          academicYearId={year.id}
          academicYearName={year.name}
          onConfirmed={() => setSetCurrentOpen(false)}
        />
      )}
    </RegionConfigProvider>
  );
}

function AcademicYearDetailPending() {
  const { t } = useTranslation('nav');
  return <RoutePending variant="detail" label={t('routePending.label', { ns: 'nav' })} />;
}

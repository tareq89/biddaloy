import { Permission } from '@biddaloy/shared';
import { ApiError } from '@biddaloy/ui/api';
import { ErrorState, Skeleton, StatusBadge } from '@biddaloy/ui/components';
import { useAcademicYear, useHasPermission, useUpdateAcademicYear } from '@biddaloy/ui/hooks';
import { RegionConfigProvider, useTenantRegionConfig, useTranslation } from '@biddaloy/ui/i18n';
import { DetailShell, useDetailShellTab } from '@biddaloy/ui/shells';
import { formatAcademicYear, formatDate, parseServerDate } from '@biddaloy/ui/utils';
import { createFileRoute, Link, useNavigate } from '@tanstack/react-router';
import * as React from 'react';

import { DeleteYearDialog } from './-delete-year-dialog';
import { ClassesTab } from './-detail/classes-tab';
import { FeeStructuresTab } from './-detail/fee-structures-tab';
import { StatisticsTab } from './-detail/statistics-tab';
import { SetCurrentDialog } from './-set-current-dialog';
import { YearFormDialog, type YearFormPayload } from './-year-form-dialog';

export const Route = createFileRoute('/_staff/academic-years/$academicYearId')({
  component: AcademicYearDetailPage,
});

const TAB_IDS = ['classes', 'feeStructures', 'statistics'] as const;

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
  const [activeTab, setActiveTab] = useDetailShellTab(TAB_IDS);
  const canManage = useHasPermission(Permission.ACADEMIC_YEAR_MANAGE);

  const updateYear = useUpdateAcademicYear(academicYearId);
  const [editOpen, setEditOpen] = React.useState(false);
  const [deleteOpen, setDeleteOpen] = React.useState(false);
  const [setCurrentOpen, setSetCurrentOpen] = React.useState(false);

  if (yearQuery.isPending) {
    return (
      <div className="flex flex-col gap-2" aria-hidden="true">
        <Skeleton className="h-8 w-1/3" />
        <Skeleton className="h-40 w-full" />
      </div>
    );
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

  function handleUpdate(payload: YearFormPayload) {
    updateYear.mutate(payload, { onSuccess: () => setEditOpen(false) });
  }

  return (
    <RegionConfigProvider value={regionConfig}>
      <div className="flex flex-col gap-4">
        <Link to="/academic-years" className="text-sm text-primary underline">
          {t('list.title')}
        </Link>

        <DetailShell
          name={formatAcademicYear(parseServerDate(year.start_date), regionConfig)}
          identifiers={
            <>
              {formatDate(parseServerDate(year.start_date), regionConfig)} –{' '}
              {formatDate(parseServerDate(year.end_date), regionConfig)}
            </>
          }
          statusBadge={
            <StatusBadge
              domain="academicYear"
              status={year.is_current ? 'CURRENT' : 'NOT_CURRENT'}
            />
          }
          actions={[
            {
              id: 'edit',
              label: t('list.edit'),
              onClick: () => setEditOpen(true),
              allowed: canManage,
            },
            ...(!year.is_current
              ? [
                  {
                    id: 'set-current',
                    label: t('list.setCurrent'),
                    onClick: () => setSetCurrentOpen(true),
                    allowed: canManage,
                  },
                ]
              : []),
            {
              id: 'delete',
              label: t('list.delete'),
              onClick: () => setDeleteOpen(true),
              variant: 'destructive',
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
            {
              id: 'statistics',
              label: t('detail.tabStatistics'),
              content: <StatisticsTab academicYearId={year.id} />,
            },
          ]}
          activeTab={activeTab}
          onTabChange={setActiveTab}
        />

        {canManage && (
          <YearFormDialog
            open={editOpen}
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
          <SetCurrentDialog
            open={setCurrentOpen}
            onOpenChange={setSetCurrentOpen}
            academicYearId={year.id}
            academicYearName={year.name}
            onConfirmed={() => setSetCurrentOpen(false)}
          />
        )}
      </div>
    </RegionConfigProvider>
  );
}

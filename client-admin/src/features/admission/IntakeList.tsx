/**
 * [27.9] [71.4.x] Admission rounds list (create moved to the four-step wizard, #4196) — table→card responsive via `ListShell`,
 * cloned from the grading-scales list shell
 * (`client-admin/src/routes/_staff/grading-scales/index.tsx`). The whole
 * screen is already gated behind `ADMISSION_REVIEW` at the route level
 * (`_staff.tsx` + `route-permissions.ts`), so every action here is shown
 * unconditionally — there's no separate "read only" role for this screen.
 */
import { StatusBadge, toast, type DataTableColumn } from '@biddaloy/ui/components';
import { usePreviewToken, useWebsiteConfig } from '@biddaloy/ui/hooks';
import { useRegionConfig, useTranslation } from '@biddaloy/ui/i18n';
import { ListShell, useListShellState } from '@biddaloy/ui/shells';
import { formatDateRange, formatNumber } from '@biddaloy/ui/utils';
import { useNavigate } from '@tanstack/react-router';
import { DoorOpenIcon, GlobeIcon, LinkIcon, PlusIcon } from 'lucide-react';

import { useIntakes, type IntakeListRow } from './hooks/useIntakes';

export function IntakeList() {
  const { t } = useTranslation('admission-staff-intakes');
  const [state, actions] = useListShellState();
  const intakesQuery = useIntakes();
  const regionConfig = useRegionConfig();
  const navigate = useNavigate();
  const website = useWebsiteConfig();
  const preview = usePreviewToken();
  const hasSite = website.data?.has_published === true;
  const noSite = website.isSuccess && !hasSite;

  // The live site address is the origin of the preview link (as on the website address screen).
  async function handleCopyLink() {
    try {
      const { data } = await preview.refetch();
      if (!data?.url) throw new Error('no site address');
      await navigator.clipboard.writeText(`${new URL(data.url).origin}/admission`);
      toast.success(t('list.linkCopied'));
    } catch {
      toast.error(t('list.linkCopyFailed'));
    }
  }

  const columns: DataTableColumn<IntakeListRow>[] = [
    {
      id: 'title',
      header: t('list.columnTitle'),
      accessorFn: (row) => <span className="font-medium">{row.title}</span>,
      card: 'title',
    },
    {
      id: 'class',
      header: t('list.columnClass'),
      accessorFn: (row) => row.class_name ?? '—',
      card: 'subtitle',
    },
    {
      id: 'seatCount',
      header: t('list.columnSeatCount'),
      accessorFn: (row) => formatNumber(row.seat_count, regionConfig),
      align: 'end',
    },
    {
      id: 'template',
      header: t('list.columnTemplate'),
      accessorFn: (row) => (row.template_key ? t(`list.template.${row.template_key}`) : '—'),
    },
    {
      id: 'window',
      header: t('list.columnWindow'),
      accessorFn: (row) => formatDateRange(row.open_date, row.close_date, regionConfig),
    },
    {
      id: 'status',
      header: t('list.columnStatus'),
      accessorFn: (row) => (
        <StatusBadge
          tone={row.status === 'OPEN' ? 'success' : 'neutral'}
          label={row.status === 'OPEN' ? t('list.statusOpen') : t('list.statusClosed')}
        />
      ),
      card: 'badge',
    },
  ];

  return (
    <>
      <ListShell
        title={t('list.title')}
        subtitle={t('list.subtitle')}
        actions={[
          {
            id: 'add',
            label: t('list.addIntake'),
            icon: <PlusIcon aria-hidden />,
            priority: 'primary',
            to: '/admissions/intakes/new',
            helpId: 'people.admissionIntakes.action.add',
          },
          ...(hasSite
            ? [
                {
                  id: 'copy-link',
                  label: t('list.copyPublicLink'),
                  icon: <LinkIcon aria-hidden />,
                  priority: 'secondary' as const,
                  onClick: () => void handleCopyLink(),
                },
              ]
            : []),
          ...(noSite
            ? [
                {
                  id: 'publish-site',
                  label: t('list.publishSiteFirst'),
                  icon: <GlobeIcon aria-hidden />,
                  priority: 'secondary' as const,
                  to: '/website',
                },
              ]
            : []),
        ]}
        tableId="admission-intakes-list"
        caption={t('list.caption')}
        columns={columns}
        data={intakesQuery.data ?? []}
        getRowId={(row) => row.id}
        sorting={state.sorting}
        onSortingChange={actions.setSorting}
        page={state.page}
        pageSize={state.limit}
        totalCount={intakesQuery.data?.length ?? 0}
        onPageChange={actions.setPage}
        onPageSizeChange={actions.setLimit}
        pageSizeLabel={t('pagination.rowsPerPage', { ns: 'common' })}
        loading={intakesQuery.isLoading}
        isFetching={intakesQuery.isFetching}
        {...(intakesQuery.isError ? { error: t('list.errorMessage') } : {})}
        rowActions={(row) => [
          {
            intent: 'view',
            label: t('list.openDesk'),
            to: `/admissions/rounds/${row.id}`,
          },
          {
            intent: 'edit',
            label: t('list.edit'),
            to: `/admissions/intakes/${row.id}`,
            'data-focus-anchor': row.id,
          },
        ]}
        emptyState={{
          icon: <DoorOpenIcon aria-hidden />,
          title: t('list.emptyTitle'),
          explanation: t('list.emptyText'),
          action: {
            label: t('list.addIntake'),
            onClick: () => void navigate({ to: '/admissions/intakes/new' }),
          },
        }}
      />
    </>
  );
}

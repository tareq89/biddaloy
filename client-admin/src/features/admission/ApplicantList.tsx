/**
 * [27.10] Applicants list — table→card responsive via `ListShell`, cloned
 * from `IntakeList.tsx` (#27.9). Filterable by intake and status
 * (`FilterBar`, D6). The whole screen is gated behind `ADMISSION_REVIEW` at
 * the route level, same as the intakes screen — every row's "Review" link
 * is shown unconditionally.
 */
import { AdmissionApplicantStatus, type AdmissionApplicantDto } from '@biddaloy/shared';
import { StatusBadge, type DataTableColumn } from '@biddaloy/ui/components';
import { useRegionConfig, useTranslation } from '@biddaloy/ui/i18n';
import { ListShell, useListShellState, type FilterFieldDescriptor } from '@biddaloy/ui/shells';
import { formatDate, formatPhone } from '@biddaloy/ui/utils';
import { UserPlusIcon } from 'lucide-react';

import { APPLICANT_STATUS } from './applicantStatus';
import { useApplicants, type ApplicantFilters } from './hooks/useApplicants';
import { useIntakes } from './hooks/useIntakes';

/** A component (not a plain string) because DataTable caches each row's cell values, so a string
 * computed before the intakes finish loading would stay "—" for good. The query is shared. */
function IntakeTitle({ intakeId }: { intakeId: string }) {
  const { data } = useIntakes();
  return <>{data?.find((i) => i.id === intakeId)?.title ?? '—'}</>;
}

export function ApplicantList() {
  const { t } = useTranslation('admission-staff-applicants');
  const [state, actions] = useListShellState();
  const regionConfig = useRegionConfig();
  const intakesQuery = useIntakes();

  const filters: ApplicantFilters = {
    ...(state.filters.intakeId ? { intakeId: state.filters.intakeId } : {}),
    ...(state.filters.status ? { status: state.filters.status as AdmissionApplicantStatus } : {}),
  };
  const applicantsQuery = useApplicants(filters);

  const filterFields: readonly FilterFieldDescriptor[] = [
    {
      kind: 'select',
      key: 'intakeId',
      label: t('list.filterIntake'),
      allLabel: t('list.filterAllIntakes'),
      options: (intakesQuery.data ?? []).map((intake) => ({
        value: intake.id,
        label: intake.title,
      })),
    },
    {
      kind: 'select',
      key: 'status',
      label: t('list.filterStatus'),
      allLabel: t('list.filterAllStatuses'),
      options: Object.values(AdmissionApplicantStatus).map((status) => ({
        value: status,
        label: t(APPLICANT_STATUS[status].labelKey),
      })),
    },
  ];

  const columns: DataTableColumn<AdmissionApplicantDto>[] = [
    {
      id: 'referenceNumber',
      header: t('list.columnReferenceNumber'),
      accessorFn: (row) => row.reference_number,
      card: 'field',
    },
    {
      id: 'applicantName',
      header: t('list.columnApplicantName'),
      accessorFn: (row) => <span className="font-medium">{row.applicant_name}</span>,
      card: 'title',
    },
    {
      id: 'intake',
      header: t('list.columnIntake'),
      accessorFn: (row) => <IntakeTitle intakeId={row.intake_id} />,
      card: 'subtitle',
    },
    {
      id: 'guardianPhone',
      header: t('list.columnGuardianPhone'),
      accessorFn: (row) => formatPhone(row.guardian_phone, regionConfig),
    },
    {
      id: 'submittedDate',
      header: t('list.columnSubmittedDate'),
      accessorFn: (row) => formatDate(row.created_at, regionConfig),
    },
    {
      id: 'status',
      header: t('list.columnStatus'),
      accessorFn: (row) => (
        <StatusBadge
          tone={APPLICANT_STATUS[row.status].tone}
          label={t(APPLICANT_STATUS[row.status].labelKey)}
        />
      ),
      card: 'badge',
    },
  ];

  return (
    <ListShell
      title={t('list.title')}
      subtitle={t('list.subtitle')}
      tableId="admission-applicants-list"
      caption={t('list.caption')}
      filters={{ fields: filterFields, values: state.filters, onChange: actions.setFilters }}
      columns={columns}
      data={applicantsQuery.data ?? []}
      getRowId={(row) => row.id}
      sorting={state.sorting}
      onSortingChange={actions.setSorting}
      page={state.page}
      pageSize={state.limit}
      totalCount={applicantsQuery.data?.length ?? 0}
      onPageChange={actions.setPage}
      onPageSizeChange={actions.setLimit}
      pageSizeLabel={t('pagination.rowsPerPage', { ns: 'common' })}
      loading={applicantsQuery.isLoading}
      isFetching={applicantsQuery.isFetching}
      {...(applicantsQuery.isError ? { error: t('list.errorMessage') } : {})}
      rowActions={(row) => [
        {
          intent: 'view',
          label: t('list.view'),
          to: `/admissions/applicants/${row.id}`,
          'data-focus-anchor': row.id,
        },
      ]}
      emptyState={{
        icon: <UserPlusIcon aria-hidden />,
        title: t('list.emptyTitle'),
        explanation: t('list.emptyText'),
      }}
    />
  );
}

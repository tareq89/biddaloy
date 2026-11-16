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

const FEE_STATES = ['NONE', 'AWAITING', 'CONFIRMED', 'SENT_BACK'] as const;
const SOURCES = ['ONLINE', 'CLERK'] as const;

/** A component (not a plain string) because DataTable caches each row's cell values, so a string
 * computed before the intakes finish loading would stay "—" for good. The query is shared. */
function IntakeTitle({ intakeId }: { intakeId: string }) {
  const { data } = useIntakes();
  return <>{data?.find((i) => i.id === intakeId)?.title ?? '—'}</>;
}

/** `intakeId` pins the list to one round (the admission desk); the round filter and column then go away. */
export function ApplicantList({ intakeId }: { intakeId?: string } = {}) {
  const { t } = useTranslation('admission-staff-applicants');
  const [state, actions] = useListShellState();
  const regionConfig = useRegionConfig();
  const intakesQuery = useIntakes();

  const filters: ApplicantFilters = {
    page: state.page,
    limit: state.limit,
    ...(state.filters.search ? { search: state.filters.search } : {}),
    ...(intakeId || state.filters.intakeId ? { intakeId: intakeId ?? state.filters.intakeId } : {}),
    ...(state.filters.status ? { status: state.filters.status as AdmissionApplicantStatus } : {}),
    ...(state.filters.fee_state
      ? { fee_state: state.filters.fee_state as NonNullable<ApplicantFilters['fee_state']> }
      : {}),
    ...(state.filters.quota_tag ? { quota_tag: state.filters.quota_tag } : {}),
    ...(state.filters.source
      ? { source: state.filters.source as NonNullable<ApplicantFilters['source']> }
      : {}),
  };
  const applicantsQuery = useApplicants(filters);

  const filterFields: readonly FilterFieldDescriptor[] = [
    {
      kind: 'text',
      key: 'search',
      label: t('list.searchLabel'),
      placeholder: t('list.searchPlaceholder'),
      primary: true,
    },
    ...(intakeId
      ? []
      : [
          {
            kind: 'select' as const,
            key: 'intakeId',
            label: t('list.filterIntake'),
            allLabel: t('list.filterAllIntakes'),
            options: (intakesQuery.data ?? []).map((intake) => ({
              value: intake.id,
              label: intake.title,
            })),
          },
        ]),
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
    {
      kind: 'select',
      key: 'fee_state',
      label: t('list.filterFee'),
      allLabel: t('list.filterAllFees'),
      options: FEE_STATES.map((v) => ({ value: v, label: t(`list.feeState.${v}`) })),
    },
    {
      kind: 'text',
      key: 'quota_tag',
      label: t('list.filterQuota'),
      placeholder: t('list.filterQuotaPlaceholder'),
    },
    {
      kind: 'select',
      key: 'source',
      label: t('list.filterSource'),
      allLabel: t('list.filterAllSources'),
      options: SOURCES.map((v) => ({ value: v, label: t(`list.source.${v}`) })),
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
    ...(intakeId
      ? []
      : [
          {
            id: 'intake',
            header: t('list.columnIntake'),
            accessorFn: (row: AdmissionApplicantDto) => <IntakeTitle intakeId={row.intake_id} />,
            card: 'subtitle' as const,
          },
        ]),
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
      data={applicantsQuery.data?.data ?? []}
      getRowId={(row) => row.id}
      sorting={null}
      onSortingChange={() => {}}
      page={state.page}
      pageSize={state.limit}
      totalCount={applicantsQuery.data?.total ?? 0}
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

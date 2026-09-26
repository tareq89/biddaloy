/**
 * [27.10] Applicants list — table→card responsive via `ListShell`, cloned
 * from `IntakeList.tsx` (#27.9). Filterable by intake and status
 * (`FilterBar`, D6). The whole screen is gated behind `ADMISSION_REVIEW` at
 * the route level, same as the intakes screen — every row's "Review" link
 * is shown unconditionally.
 */
import { AdmissionApplicantStatus, type AdmissionApplicantDto } from '@biddaloy/shared';
import { type DataTableColumn } from '@biddaloy/ui/components';
import { useTranslation } from '@biddaloy/ui/i18n';
import { ListShell, useListShellState, type FilterFieldDescriptor } from '@biddaloy/ui/shells';
import { Link } from '@tanstack/react-router';

import { useApplicants, type ApplicantFilters } from './hooks/useApplicants';
import { useIntakes } from './hooks/useIntakes';

const STATUS_BADGE_CLASS: Record<AdmissionApplicantStatus, string> = {
  [AdmissionApplicantStatus.PENDING]: 'bg-muted text-muted-foreground',
  [AdmissionApplicantStatus.SHORTLISTED]: 'bg-status-pending-bg text-status-pending-fg',
  [AdmissionApplicantStatus.ADMITTED]: 'bg-status-paid-bg text-status-paid-fg',
  [AdmissionApplicantStatus.REJECTED]: 'bg-status-overdue-bg text-status-overdue-fg',
};

export function ApplicantList() {
  const { t } = useTranslation('admission-staff-applicants');
  const [state, actions] = useListShellState({ limit: 25 });
  const intakesQuery = useIntakes();

  const filters: ApplicantFilters = {
    ...(state.filters.intakeId ? { intakeId: state.filters.intakeId } : {}),
    ...(state.filters.status ? { status: state.filters.status as AdmissionApplicantStatus } : {}),
  };
  const applicantsQuery = useApplicants(filters);

  const statusLabel: Record<AdmissionApplicantStatus, string> = {
    [AdmissionApplicantStatus.PENDING]: t('list.statusPending'),
    [AdmissionApplicantStatus.SHORTLISTED]: t('list.statusShortlisted'),
    [AdmissionApplicantStatus.ADMITTED]: t('list.statusAdmitted'),
    [AdmissionApplicantStatus.REJECTED]: t('list.statusRejected'),
  };

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
        label: statusLabel[status],
      })),
    },
  ];

  const columns: DataTableColumn<AdmissionApplicantDto>[] = [
    {
      id: 'referenceNumber',
      header: t('list.columnReferenceNumber'),
      accessorFn: (row) => (
        <Link
          to="/admissions/applicants/$applicantId"
          params={{ applicantId: row.id }}
          className="font-medium text-primary underline"
        >
          {row.reference_number}
        </Link>
      ),
    },
    {
      id: 'applicantName',
      header: t('list.columnApplicantName'),
      accessorFn: (row) => row.applicant_name,
    },
    {
      id: 'guardianPhone',
      header: t('list.columnGuardianPhone'),
      accessorFn: (row) => row.guardian_phone,
    },
    {
      id: 'status',
      header: t('list.columnStatus'),
      accessorFn: (row) => (
        <span
          className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_BADGE_CLASS[row.status]}`}
        >
          {statusLabel[row.status]}
        </span>
      ),
    },
    {
      id: 'submittedDate',
      header: t('list.columnSubmittedDate'),
      accessorFn: (row) => row.created_at.slice(0, 10),
    },
  ];

  return (
    <ListShell
      title={t('list.title')}
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
      emptyMessage={t('list.emptyMessage')}
    />
  );
}

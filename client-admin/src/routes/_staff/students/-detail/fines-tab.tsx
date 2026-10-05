/**
 * [38.4.4] Student detail's "Fines" tab — every fine (any status) logged
 * against this one student, with actions to log a new one and waive an
 * existing one. Cloned from `recurring-fees-tab.tsx`'s shell/`TabQueryState`
 * conventions, table columns from `fees-tab.tsx`'s `FeeLinesTable`.
 *
 * Both actions are permission-gated (D8/D11/D25): `FEE_GENERATE` to log,
 * `FEE_APPROVE` to waive — a fine is waived through the same
 * `ApprovalScope.FEES_DISCOUNT` step-up as a discount, so ACCOUNTANT
 * (which has FEE_GENERATE but not FEE_APPROVE) can log but not waive.
 */
import { FeeStatus, Permission } from '@biddaloy/shared';
import {
  Button,
  Card,
  DataTable,
  EmptyState,
  StatusBadge,
  type DataTableColumn,
} from '@biddaloy/ui/components';
import { useFines, useHasPermission, type Fine } from '@biddaloy/ui/hooks';
import { useRegionConfig, useTranslation } from '@biddaloy/ui/i18n';
import { formatDate, formatServerAmount, parseServerDate } from '@biddaloy/ui/utils';
import { BadgeCheckIcon, PlusIcon } from 'lucide-react';
import * as React from 'react';

import { LogFineModal } from '../../fees/fines/-modals/log-fine-modal';
import { WaiveFineDialog } from '../../fees/fines/-modals/waive-fine-dialog';

import { TabQueryState } from './tab-query-state';

export interface FinesTabProps {
  studentId: string;
}

export function FinesTab({ studentId }: FinesTabProps) {
  const { t } = useTranslation('fines');
  const { t: tStudents } = useTranslation('students');
  const regionConfig = useRegionConfig();
  const canLog = useHasPermission(Permission.FEE_GENERATE);
  const canWaive = useHasPermission(Permission.FEE_APPROVE);
  const finesQuery = useFines({ student_id: studentId });
  const [logOpen, setLogOpen] = React.useState(false);
  const [waiveFineId, setWaiveFineId] = React.useState<string | null>(null);

  return (
    <div className="flex flex-col gap-4">
      {canLog && (
        <div className="flex justify-end">
          <Button
            type="button"
            variant="outline"
            className="w-full md:w-auto"
            onClick={() => setLogOpen(true)}
          >
            <PlusIcon className="size-4" aria-hidden />
            {t('logForm.title')}
          </Button>
        </div>
      )}

      <TabQueryState
        query={finesQuery}
        forbiddenMessage={t('detail.forbidden', { ns: 'students' })}
        errorMessage={tStudents('detail.fines.errorMessage')}
      >
        {(data) => {
          const fines = data.items;
          const dateOf = (fine: Fine) =>
            fine.incident_date
              ? formatDate(parseServerDate(fine.incident_date), regionConfig)
              : '—';
          const columns: DataTableColumn<Fine>[] = [
            {
              id: 'fine',
              header: t('columns.fine'),
              accessorFn: (fine) => fine.fee_name,
              card: 'title',
            },
            { id: 'reason', header: t('columns.reason'), accessorFn: (fine) => fine.note ?? '' },
            { id: 'incidentDate', header: t('columns.incidentDate'), accessorFn: dateOf },
            {
              id: 'amount',
              header: t('columns.amount'),
              align: 'end',
              accessorFn: (fine) => formatServerAmount(fine.total_amount, regionConfig),
            },
            {
              id: 'paid',
              header: t('columns.paid'),
              align: 'end',
              accessorFn: (fine) => formatServerAmount(fine.paid_amount, regionConfig),
            },
            {
              id: 'status',
              header: t('columns.status'),
              accessorFn: (fine) => <StatusBadge domain="fee" status={fine.status as FeeStatus} />,
              card: 'badge',
            },
            {
              id: 'origin',
              header: t('columns.origin'),
              accessorFn: (fine) => t(`origin.${fine.origin ?? 'MANUAL'}`),
            },
          ];

          return (
            <div className="flex flex-col gap-4">
              {fines.length > 0 && (
                <Card>
                  <dl className="grid grid-cols-2 divide-x divide-border-subtle">
                    <div className="p-4 md:p-5">
                      <dt className="text-caption text-text-secondary">
                        {t('totals.outstanding')}
                      </dt>
                      <dd className="mt-1 text-h3 tabular-nums md:text-h2">
                        {formatServerAmount(data.totals.outstanding, regionConfig)}
                      </dd>
                    </div>
                    <div className="p-4 md:p-5">
                      <dt className="text-caption text-text-secondary">{t('totals.waived')}</dt>
                      <dd className="mt-1 text-h3 tabular-nums md:text-h2">
                        {formatServerAmount(data.totals.waived, regionConfig)}
                      </dd>
                    </div>
                  </dl>
                </Card>
              )}
              {fines.length === 0 ? (
                <EmptyState
                  icon={<BadgeCheckIcon aria-hidden="true" />}
                  title={t('empty.title')}
                  explanation={t('empty.description')}
                />
              ) : (
                <DataTable
                  tableId="student-fines"
                  caption={tStudents('detail.tabs.fines')}
                  paginated={false}
                  sorting={null}
                  onSortingChange={() => {}}
                  columns={columns}
                  data={fines}
                  getRowId={(fine) => fine.id}
                  totalCount={fines.length}
                  rowActions={(fine) => [
                    {
                      intent: 'remove',
                      label: t('waiveDialog.title'),
                      onClick: () => setWaiveFineId(fine.id),
                      allowed: canWaive && fine.status !== 'WAIVED' && fine.status !== 'PAID',
                    },
                  ]}
                />
              )}
            </div>
          );
        }}
      </TabQueryState>

      {canLog && (
        <LogFineModal open={logOpen} onOpenChange={setLogOpen} prefillStudentIds={[studentId]} />
      )}
      {canWaive && waiveFineId !== null && (
        <WaiveFineDialog
          open
          onOpenChange={(open) => {
            if (!open) setWaiveFineId(null);
          }}
          fineId={waiveFineId}
          studentId={studentId}
        />
      )}
    </div>
  );
}

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
  StatusBadge,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@biddaloy/ui/components';
import { useFines, useHasPermission, type Fine } from '@biddaloy/ui/hooks';
import { useRegionConfig, useTranslation } from '@biddaloy/ui/i18n';
import { formatDate, formatServerAmount, parseServerDate } from '@biddaloy/ui/utils';
import * as React from 'react';

import { LogFineModal } from '../../fees/fines/-modals/log-fine-modal';
import { WaiveFineDialog } from '../../fees/fines/-modals/waive-fine-dialog';

import { TabQueryState } from './tab-query-state';

export interface FinesTabProps {
  studentId: string;
}

export function FinesTab({ studentId }: FinesTabProps) {
  const { t } = useTranslation('fines');
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
          <Button type="button" onClick={() => setLogOpen(true)}>
            {t('logForm.title')}
          </Button>
        </div>
      )}

      <TabQueryState
        query={finesQuery}
        forbiddenMessage={t('detail.forbidden', { ns: 'students' })}
        errorMessage={t('empty.title')}
      >
        {(data) => {
          const fines = data.items;
          if (fines.length === 0) {
            return (
              <div className="flex flex-col items-center gap-1 rounded-lg border border-dashed border-border-subtle p-8 text-center">
                <p className="text-sm font-medium">{t('empty.title')}</p>
                <p className="text-sm text-muted-foreground">{t('empty.description')}</p>
              </div>
            );
          }

          return (
            <div className="flex flex-col gap-4">
              <p className="text-sm text-muted-foreground">
                {t('totals.outstanding')}:{' '}
                {formatServerAmount(data.totals.outstanding, regionConfig)} · {t('totals.waived')}:{' '}
                {formatServerAmount(data.totals.waived, regionConfig)}
              </p>

              {/* Phone: cards, one per fine. */}
              <ul className="flex flex-col gap-2 sm:hidden">
                {fines.map((fine) => (
                  <FineCard
                    key={fine.id}
                    fine={fine}
                    canWaive={canWaive}
                    onWaive={() => setWaiveFineId(fine.id)}
                  />
                ))}
              </ul>

              <Table className="hidden sm:table">
                <TableHeader>
                  <TableRow>
                    <TableHead>{t('columns.fine')}</TableHead>
                    <TableHead>{t('columns.reason')}</TableHead>
                    <TableHead>{t('columns.incidentDate')}</TableHead>
                    <TableHead>{t('columns.amount')}</TableHead>
                    <TableHead>{t('columns.paid')}</TableHead>
                    <TableHead>{t('columns.status')}</TableHead>
                    <TableHead>{t('columns.origin')}</TableHead>
                    {canWaive && <TableHead />}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {fines.map((fine) => (
                    <TableRow key={fine.id}>
                      <TableCell>{fine.fee_name}</TableCell>
                      <TableCell>{fine.note ?? ''}</TableCell>
                      <TableCell>
                        {fine.incident_date
                          ? formatDate(parseServerDate(fine.incident_date), regionConfig)
                          : '—'}
                      </TableCell>
                      <TableCell>{formatServerAmount(fine.total_amount, regionConfig)}</TableCell>
                      <TableCell>{formatServerAmount(fine.paid_amount, regionConfig)}</TableCell>
                      <TableCell>
                        <StatusBadge domain="fee" status={fine.status as FeeStatus} />
                      </TableCell>
                      <TableCell>{t(`origin.${fine.origin ?? 'MANUAL'}`)}</TableCell>
                      {canWaive && (
                        <TableCell>
                          {fine.status !== 'WAIVED' && fine.status !== 'PAID' && (
                            <Button
                              type="button"
                              size="sm"
                              variant="outline"
                              onClick={() => setWaiveFineId(fine.id)}
                            >
                              {t('waiveDialog.title')}
                            </Button>
                          )}
                        </TableCell>
                      )}
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
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

function FineCard({
  fine,
  canWaive,
  onWaive,
}: {
  fine: Fine;
  canWaive: boolean;
  onWaive: () => void;
}) {
  const { t } = useTranslation('fines');
  const regionConfig = useRegionConfig();
  return (
    <li className="flex flex-col gap-2 rounded-lg border border-border-subtle p-3">
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium">{fine.fee_name}</span>
        <StatusBadge domain="fee" status={fine.status as FeeStatus} />
      </div>
      {fine.note && <p className="text-sm text-muted-foreground">{fine.note}</p>}
      <p className="text-sm text-muted-foreground">
        {fine.incident_date ? formatDate(parseServerDate(fine.incident_date), regionConfig) : '—'} ·{' '}
        {formatServerAmount(fine.total_amount, regionConfig)}
      </p>
      {canWaive && fine.status !== 'WAIVED' && fine.status !== 'PAID' && (
        <Button type="button" size="sm" variant="outline" onClick={onWaive}>
          {t('waiveDialog.title')}
        </Button>
      )}
    </li>
  );
}

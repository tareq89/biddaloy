/**
 * [28.4.2] Staff detail › Incidents tab: this person's incidents plus a
 * Report button (ACR_WRITE) that opens the shared `ReportIncidentDialog`.
 */
import { Permission } from '@biddaloy/shared';
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  EmptyState,
  Label,
  StatusBadge,
  Textarea,
  toast,
  type StatusTone,
} from '@biddaloy/ui/components';
import { useHasPermission, useIncidents, useWithdrawIncident } from '@biddaloy/ui/hooks';
import { useTenantRegionConfig, useTranslation } from '@biddaloy/ui/i18n';
import { formatDate, parseDate } from '@biddaloy/ui/utils';
import { FlagIcon, Undo2Icon } from 'lucide-react';
import * as React from 'react';

import { ReportIncidentDialog } from './report-incident-dialog';
import { TabQueryState } from './tab-query-state';

const SEVERITY_TONE: Record<string, StatusTone> = {
  LOW: 'neutral',
  MEDIUM: 'warning',
  HIGH: 'danger',
};

export interface IncidentsTabProps {
  userId: string;
}

/**
 * GAP-11: withdraw an incident. Needs a reason, so this is a small Dialog with
 * a Textarea rather than `ConfirmDialog` (no body slot). The confirm button
 * stays default tone: filled red lives only in `ConfirmDialog`.
 */
function WithdrawIncidentDialog({
  incidentId,
  onClose,
}: {
  /** The incident being withdrawn; `null` keeps the dialog closed. */
  incidentId: string | null;
  onClose: () => void;
}) {
  const { t } = useTranslation('evaluations');
  const withdraw = useWithdrawIncident();
  const [reason, setReason] = React.useState('');
  const [missing, setMissing] = React.useState(false);

  React.useEffect(() => {
    if (incidentId === null) return;
    setReason('');
    setMissing(false);
    withdraw.reset();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reset on open only
  }, [incidentId]);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (withdraw.isPending || incidentId === null) return;
    if (!reason.trim()) {
      setMissing(true);
      return;
    }
    withdraw.mutate(
      { id: incidentId, reason: reason.trim() },
      {
        onSuccess: () => {
          toast.success(t('incident.withdraw.done'));
          onClose();
        },
      },
    );
  }

  return (
    <Dialog
      open={incidentId !== null}
      onOpenChange={(open) => !open && !withdraw.isPending && onClose()}
    >
      <DialogContent size="sm">
        <DialogHeader>
          <DialogTitle>{t('incident.withdraw.title')}</DialogTitle>
          <DialogDescription>{t('incident.withdraw.description')}</DialogDescription>
        </DialogHeader>
        <form noValidate className="flex flex-col gap-4" onSubmit={submit}>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="incident-withdraw-reason">{t('incident.withdraw.reasonLabel')}</Label>
            <Textarea
              id="incident-withdraw-reason"
              rows={3}
              maxLength={500}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              {...(missing
                ? { 'aria-invalid': true as const, 'aria-describedby': 'incident-withdraw-error' }
                : {})}
            />
            {missing && (
              <p id="incident-withdraw-error" role="alert" className="text-sm text-destructive">
                {t('incident.withdraw.reasonRequired')}
              </p>
            )}
          </div>
          {withdraw.isError && (
            <p role="alert" className="text-sm text-destructive">
              {t('incident.withdraw.error')}
            </p>
          )}
          <DialogFooter>
            <Button type="button" variant="outline" disabled={withdraw.isPending} onClick={onClose}>
              {t('actions.cancel', { ns: 'common' })}
            </Button>
            <Button type="submit" variant="destructive" loading={withdraw.isPending}>
              {t('incident.withdraw.confirm')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function IncidentsTab({ userId }: IncidentsTabProps) {
  const { t } = useTranslation('evaluations');
  const regionConfig = useTenantRegionConfig();
  const query = useIncidents({ staffUserId: userId });
  const canWrite = useHasPermission(Permission.ACR_WRITE);
  const [reportOpen, setReportOpen] = React.useState(false);
  const [withdrawId, setWithdrawId] = React.useState<string | null>(null);

  return (
    <section className="rounded-lg border border-border-subtle bg-surface p-4 shadow-e1 md:p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-h2">{t('incident.title')}</h2>
        {canWrite && (
          <Button type="button" variant="outline" onClick={() => setReportOpen(true)}>
            <FlagIcon aria-hidden="true" />
            {t('incident.report')}
          </Button>
        )}
      </div>
      <div className="mt-4">
        <TabQueryState
          query={query}
          forbiddenMessage={t('forbidden')}
          errorMessage={t('incident.loadError')}
        >
          {(rows) =>
            rows.length === 0 ? (
              <EmptyState title={t('incident.title')} explanation={t('incident.empty')} />
            ) : (
              <ul className="divide-y divide-border-subtle">
                {rows.map((r) => (
                  <li key={r.id} className="flex flex-col gap-1 py-3 first:pt-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-medium">{t(`incident.types.${r.type}`)}</span>
                      <StatusBadge
                        tone={SEVERITY_TONE[r.severity] ?? 'neutral'}
                        label={t(`incident.severities.${r.severity}`)}
                      />
                    </div>
                    <span className="text-text-secondary">
                      {formatDate(parseDate(r.occurredOn), regionConfig)}
                    </span>
                    <span>{r.description}</span>
                    {canWrite && (
                      <Button
                        type="button"
                        variant="ghost"
                        className="self-start"
                        onClick={() => setWithdrawId(r.id)}
                      >
                        <Undo2Icon aria-hidden="true" />
                        {t('incident.withdraw.action')}
                      </Button>
                    )}
                  </li>
                ))}
              </ul>
            )
          }
        </TabQueryState>
      </div>
      {canWrite && (
        <>
          <ReportIncidentDialog
            open={reportOpen}
            onOpenChange={setReportOpen}
            staffUserId={userId}
          />
          <WithdrawIncidentDialog incidentId={withdrawId} onClose={() => setWithdrawId(null)} />
        </>
      )}
    </section>
  );
}

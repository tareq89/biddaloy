/**
 * [97.4.02] One message of the log: every field the log row carries, plus the Check status button
 * (D23). The button is rendered only when the caller says it can do something; the server still
 * decides (409 when it cannot, 502 when the company did not answer), and its fixed sentence is
 * what the user reads, never the company's own text (Rule 23/24).
 */
import {
  Button,
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  StatusBadge,
} from '@biddaloy/ui/components';
import { useRegionConfig, useTranslation } from '@biddaloy/ui/i18n';
import { formatDateTime, formatPhone } from '@biddaloy/ui/utils';

import { deliveryErrorKey } from '../-shared/delivery-error';

import type { LogRow } from './-log-row';

export interface RowDetailProps {
  row: LogRow | undefined;
  onClose: () => void;
  /** Provider name -> label, from the providers list (empty when the user cannot read it). */
  companyLabel: (name: string | null) => string | null;
  canCheck: boolean;
  checking: boolean;
  onCheck: () => void;
}

export function RowDetail({
  row,
  onClose,
  companyLabel,
  canCheck,
  checking,
  onCheck,
}: RowDetailProps) {
  const { t } = useTranslation('communications');
  const config = useRegionConfig();
  if (!row) return null;

  const none = t('messageLog.detail.none');
  const errorKey = deliveryErrorKey(row.error);
  const fields: [string, React.ReactNode][] = [
    [t('messageLog.detail.recipient'), row.recipient_name],
    [
      t('batches.detail.addressHeader'),
      row.medium === 'EMAIL' ? row.recipient_address : formatPhone(row.recipient_address, config),
    ],
    [t('messageLog.detail.channel'), t(`mediums.${row.medium}`)],
    [
      t('messageLog.detail.status'),
      <StatusBadge key="s" domain="communication" status={row.status} />,
    ],
    [t('messageLog.detail.kind'), row.trigger ? t(`messageLog.triggers.${row.trigger}`) : none],
    [t('messageLog.detail.company'), companyLabel(row.provider) ?? row.provider ?? none],
    [t('messageLog.detail.providerMessageId'), row.provider_message_id ?? none],
    [t('messageLog.detail.sent'), formatDateTime(new Date(row.created_at), config)],
    [
      t('messageLog.detail.error'),
      errorKey ? t(errorKey, { medium: t(`mediums.${row.medium}`) }) : none,
    ],
  ];

  return (
    <Dialog open onOpenChange={(open) => !open && !checking && onClose()}>
      <DialogContent size="sm">
        <DialogHeader>
          <DialogTitle>{t('messageLog.detail.title')}</DialogTitle>
        </DialogHeader>
        <dl className="flex flex-col gap-3">
          {fields.map(([label, value]) => (
            <div key={label}>
              <dt className="text-caption text-text-secondary">{label}</dt>
              <dd className="break-words">{value}</dd>
            </div>
          ))}
        </dl>
        <DialogFooter>
          {canCheck && (
            <Button variant="secondary" loading={checking} onClick={onCheck}>
              {t(checking ? 'messageLog.checkStatusBusy' : 'messageLog.checkStatus')}
            </Button>
          )}
          <Button variant="secondary" onClick={onClose} disabled={checking}>
            {t('messageLog.detail.close')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

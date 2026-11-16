/**
 * [71.4.05] One fee proof, big: look at the file, then "Fee is ok" or "Send back" with a reason.
 * A repeated reference only warns (D14); it never blocks.
 */
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Label,
  Textarea,
} from '@biddaloy/ui/components';
import { useConfirmFeeProof, useSendBackFeeProof, type FeeProofList } from '@biddaloy/ui/hooks';
import { useRegionConfig, useTranslation } from '@biddaloy/ui/i18n';
import { formatCurrency } from '@biddaloy/ui/utils';
import * as React from 'react';

import { useFeeProofAttachment } from '../hooks/useFeeProofAttachment';

export type FeeProofRow = FeeProofList['data'][number];
/** Server cap on the send-back reason. */
export const REASON_MAX = 300;

interface Props {
  proof: FeeProofRow;
  /** The round's fee in whole paisa (a proof row carries no amount). */
  amountPaisa: number | null | undefined;
  onClose: () => void;
}

export function FeeVerifyDialog({ proof, amountPaisa, onClose }: Props) {
  const { t } = useTranslation('admission-desk');
  const region = useRegionConfig();
  const file = useFeeProofAttachment(proof.id);
  const confirm = useConfirmFeeProof();
  const sendBack = useSendBackFeeProof(proof.id);
  const [reason, setReason] = React.useState('');
  const [failed, setFailed] = React.useState(false);
  const busy = confirm.isPending || sendBack.isPending;
  const done = { onSuccess: onClose, onError: () => setFailed(true) };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent size="lg" className="max-h-dvh overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{t('fee.title', { name: proof.applicant_name })}</DialogTitle>
          <DialogDescription>
            {t('fee.description', { ref: proof.applicant_reference_number })}
          </DialogDescription>
        </DialogHeader>

        {proof.seen_before > 0 ? (
          <p role="status" className="rounded-md bg-status-due-bg p-3 text-sm text-status-due-fg">
            {t('fee.seenBefore')}
          </p>
        ) : null}

        <div className="flex min-h-48 items-center justify-center rounded-md border bg-muted/30">
          {file.status === 'loading' ? <p role="status">{t('fee.fileLoading')}</p> : null}
          {file.status === 'error' ? <p role="alert">{t('fee.fileError')}</p> : null}
          {file.status === 'ready' && file.type === 'application/pdf' ? (
            <iframe src={file.url} title={t('fee.fileTitle')} className="h-96 w-full" />
          ) : null}
          {file.status === 'ready' && file.type !== 'application/pdf' ? (
            <img src={file.url} alt={t('fee.fileTitle')} className="max-h-96 object-contain" />
          ) : null}
        </div>

        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
          <dt className="text-muted-foreground">{t('fee.amount')}</dt>
          <dd>{formatCurrency(amountPaisa, region)}</dd>
          <dt className="text-muted-foreground">{t('fee.method')}</dt>
          <dd>{proof.method ? t(`wizard.method.${proof.method}`) : '—'}</dd>
          <dt className="text-muted-foreground">{t('fee.reference')}</dt>
          <dd>{proof.reference || '—'}</dd>
        </dl>

        <div className="flex flex-col gap-1">
          <Label htmlFor="fee-reason">{t('fee.reasonLabel')}</Label>
          <Textarea
            id="fee-reason"
            value={reason}
            maxLength={REASON_MAX}
            onChange={(e) => setReason(e.target.value)}
          />
          <span className="text-xs text-muted-foreground">
            {t('fee.reasonCount', { used: reason.length, max: REASON_MAX })}
          </span>
        </div>

        {failed ? <p role="alert">{t('fee.errors.decide')}</p> : null}

        <DialogFooter>
          <Button
            variant="outline"
            disabled={busy || reason.trim() === ''}
            onClick={() => {
              setFailed(false);
              sendBack.mutate({ reason: reason.trim() }, done);
            }}
          >
            {t('fee.sendBack')}
          </Button>
          <Button
            disabled={busy}
            onClick={() => {
              setFailed(false);
              confirm.mutate(proof.id, done);
            }}
          >
            {t('fee.confirm')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

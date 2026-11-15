import { PaymentProofRejectReason } from '@biddaloy/shared';
import {
  Button,
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@biddaloy/ui/components';
import { useRejectPaymentProof, type ProofReviewDetail } from '@biddaloy/ui/hooks';
import { useTranslation } from '@biddaloy/ui/i18n';
import * as React from 'react';

const NOTE_MAX_LENGTH = 500;

export interface RejectProofDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  proofId: string;
  onRejected: (detail: ProofReviewDetail) => void;
}

/**
 * D42: the reason is a fixed list. "Other" needs a note; the note is shown to the guardian,
 * and no error here echoes what was typed (rule 23). Mounted only while open, so state resets.
 */
export function RejectProofDialog({
  open,
  onOpenChange,
  proofId,
  onRejected,
}: RejectProofDialogProps) {
  const { t } = useTranslation('onlinePayments');
  const reject = useRejectPaymentProof();
  const [reason, setReason] = React.useState<PaymentProofRejectReason | ''>('');
  const [note, setNote] = React.useState('');

  const trimmed = note.trim();
  const needsNote = reason === PaymentProofRejectReason.OTHER;
  const invalid = reason === '' || (needsNote && trimmed === '');

  function submit() {
    if (invalid) return;
    reject.mutate(
      { id: proofId, reason, ...(trimmed !== '' ? { note: trimmed } : {}) },
      {
        onSuccess: (detail) => {
          onOpenChange(false);
          onRejected(detail);
        },
      },
    );
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        // Closing mid-request would hide the answer of a decision that still lands.
        if (!next && reject.isPending) return;
        onOpenChange(next);
      }}
    >
      <DialogContent size="md">
        <DialogHeader>
          <DialogTitle>{t('reject.title')}</DialogTitle>
          <DialogDescription>{t('reject.description')}</DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="reject-reason">{t('reject.reasonLabel')}</Label>
          <Select value={reason} onValueChange={(v) => setReason(v as PaymentProofRejectReason)}>
            <SelectTrigger
              id="reject-reason"
              aria-label={t('reject.reasonLabel')}
              className="w-full"
            >
              <SelectValue placeholder={t('reject.reasonPlaceholder')} />
            </SelectTrigger>
            <SelectContent>
              {Object.values(PaymentProofRejectReason).map((value) => (
                <SelectItem key={value} value={value}>
                  {t(`reject.reasons.${value}`)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="reject-note">
            {t('reject.noteLabel')}
            {needsNote ? ` (${t('reject.noteRequired')})` : ''}
          </Label>
          <Input
            id="reject-note"
            value={note}
            maxLength={NOTE_MAX_LENGTH}
            required={needsNote}
            placeholder={t('reject.noteHint')}
            onChange={(event) => setNote(event.target.value)}
          />
        </div>

        {reject.isError && (
          <p role="alert" className="text-sm text-destructive">
            {t('reject.error')}
          </p>
        )}

        <DialogFooter>
          <DialogClose asChild>
            <Button type="button" variant="outline">
              {t('reject.cancel')}
            </Button>
          </DialogClose>
          <Button
            type="button"
            variant="destructive"
            disabled={invalid}
            loading={reject.isPending}
            onClick={submit}
          >
            {t('reject.submit')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

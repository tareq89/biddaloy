/**
 * [32.3.5] Revoke one printed copy (D22, D47). A reason is required, and the
 * confirm says plainly what happens: anyone scanning the card's QR code will see
 * it is no longer valid. Only shown to people with DOCUMENT_REVOKE.
 */
import {
  Button,
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Textarea,
  toast,
} from '@biddaloy/ui/components';
import { useRevokePrintItem } from '@biddaloy/ui/hooks';
import { useTranslation } from '@biddaloy/ui/i18n';
import * as React from 'react';

export const REVOKE_REASON_MAX = 280;

export interface RevokeDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  itemId: string;
  /** Who the card is for, for the title. */
  subjectLabel: string;
}

export function RevokeDialog({ open, onOpenChange, itemId, subjectLabel }: RevokeDialogProps) {
  const { t } = useTranslation('printHistory');
  const revoke = useRevokePrintItem();
  const [reason, setReason] = React.useState('');
  const [touched, setTouched] = React.useState(false);

  const trimmed = reason.trim();
  const invalid = trimmed === '';

  function handleOpenChange(next: boolean) {
    if (!next) {
      setReason('');
      setTouched(false);
      revoke.reset();
    }
    onOpenChange(next);
  }

  function handleConfirm() {
    setTouched(true);
    if (invalid) return;
    revoke.mutate(
      { itemId, reason: trimmed },
      {
        onSuccess: () => {
          toast.success(t('revoke.done'));
          handleOpenChange(false);
        },
      },
    );
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent size="sm">
        <DialogHeader>
          <DialogTitle>{t('revoke.title', { name: subjectLabel })}</DialogTitle>
        </DialogHeader>

        <p className="text-sm">{t('revoke.warning')}</p>

        <div className="flex flex-col gap-1.5">
          <label htmlFor="revoke-reason" className="text-sm font-medium">
            {t('revoke.reason')}
          </label>
          <Textarea
            id="revoke-reason"
            value={reason}
            maxLength={REVOKE_REASON_MAX}
            aria-invalid={touched && invalid}
            aria-describedby="revoke-reason-help"
            onChange={(e) => setReason(e.target.value)}
          />
          <p id="revoke-reason-help" className="text-xs text-muted-foreground">
            {t('revoke.reasonHelp')}
          </p>
          {touched && invalid ? (
            <p role="alert" className="text-sm text-destructive">
              {t('revoke.reasonRequired')}
            </p>
          ) : null}
        </div>

        {revoke.isError ? (
          <p role="alert" className="text-sm text-destructive">
            {t('revoke.failed')}
          </p>
        ) : null}

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => handleOpenChange(false)}>
            {t('revoke.cancel')}
          </Button>
          <Button
            type="button"
            variant="destructive"
            loading={revoke.isPending}
            onClick={handleConfirm}
          >
            {revoke.isPending ? t('revoke.saving') : t('revoke.confirm')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

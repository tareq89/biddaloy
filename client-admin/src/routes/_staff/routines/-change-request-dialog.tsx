/**
 * [21.9.1] A teacher flags a published slot for the builder — a note,
 * nothing else (per the ticket). `ChangeRequestsService.open` (D11)
 * refuses this against anything but a `PUBLISHED` slot; `review.tsx`
 * already disables the opening button in that case, so this dialog only
 * needs to surface a generic save error, not re-derive that rule.
 */
import { Button, Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, Textarea, toast } from '@biddaloy/ui/components';
import { useOpenChangeRequest } from '@biddaloy/ui/hooks';
import { useTranslation } from '@biddaloy/ui/i18n';
import * as React from 'react';

export interface ChangeRequestDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  routineId: string;
  slotId: string;
  onDone: () => void;
}

export function ChangeRequestDialog({
  open,
  onOpenChange,
  routineId,
  slotId,
  onDone,
}: ChangeRequestDialogProps) {
  const { t } = useTranslation('routines');
  const openChangeRequest = useOpenChangeRequest(routineId, slotId);
  const [note, setNote] = React.useState('');

  React.useEffect(() => {
    if (!open) setNote('');
  }, [open]);

  function handleSubmit() {
    if (note.trim().length === 0) return;
    openChangeRequest.mutate(
      { note: note.trim() },
      {
        onSuccess: () => {
          toast.success(t('changeRequestDialog.submittedToast'));
          onDone();
        },
        onError: () => toast.error(t('changeRequestDialog.errorToast')),
      },
    );
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('changeRequestDialog.title')}</DialogTitle>
          <DialogDescription>{t('changeRequestDialog.description')}</DialogDescription>
        </DialogHeader>

        <Textarea
          aria-label={t('changeRequestDialog.noteLabel')}
          placeholder={t('changeRequestDialog.notePlaceholder')}
          value={note}
          onChange={(event) => setNote(event.target.value)}
          maxLength={500}
        />

        <DialogFooter>
          <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
            {t('changeRequestDialog.cancel')}
          </Button>
          <Button
            type="button"
            disabled={note.trim().length === 0}
            loading={openChangeRequest.isPending}
            onClick={handleSubmit}
          >
            {t('changeRequestDialog.submit')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

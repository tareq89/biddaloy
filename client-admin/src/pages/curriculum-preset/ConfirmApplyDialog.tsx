/** [35.4.3] D13: apply stays disabled until the admin types the preset's English name exactly. */
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
} from '@biddaloy/ui/components';
import { useTranslation } from '@biddaloy/ui/i18n';
import * as React from 'react';

export interface ConfirmApplyDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The preset's English name — the phrase to type, case-sensitive. */
  presetName: string;
  onConfirm: () => void;
  pending?: boolean;
  error?: boolean;
}

export function ConfirmApplyDialog({
  open,
  onOpenChange,
  presetName,
  onConfirm,
  pending = false,
  error = false,
}: ConfirmApplyDialogProps) {
  const { t } = useTranslation('curriculumPreset');
  const [typed, setTyped] = React.useState('');

  React.useEffect(() => {
    if (open) setTyped('');
  }, [open]);

  const matches = typed === presetName;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {/* Radix focuses the first focusable (the textbox — the close button
       * is rendered after the content) and closes on Esc by default. */}
      <DialogContent className="max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{t('confirm.title', { name: presetName })}</DialogTitle>
          <DialogDescription>{t('confirm.creates')}</DialogDescription>
        </DialogHeader>
        <p className="text-sm font-medium text-destructive">{t('confirm.irreversible')}</p>
        <form
          id="confirm-apply-form"
          className="flex flex-col gap-1"
          onSubmit={(event) => {
            event.preventDefault();
            if (matches && !pending) onConfirm();
          }}
        >
          <Label htmlFor="confirm-apply-name">{t('confirm.typeLabel', { name: presetName })}</Label>
          <Input
            id="confirm-apply-name"
            autoComplete="off"
            value={typed}
            onChange={(event) => setTyped(event.target.value)}
          />
        </form>
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {t('confirm.error')}
          </p>
        )}
        <DialogFooter>
          <DialogClose asChild>
            <Button type="button" variant="outline">
              {t('confirm.cancel')}
            </Button>
          </DialogClose>
          <Button type="submit" form="confirm-apply-form" disabled={!matches} loading={pending}>
            {t('confirm.apply')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

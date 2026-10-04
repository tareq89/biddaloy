/**
 * D29: the one confirm dialog (patterns.md section 7) and the only place the
 * filled red `danger` button lives. An `alertdialog`: outside click is ignored
 * and, while `busy`, so is Esc.
 */
import { Trash2Icon } from 'lucide-react';

import { useTranslation } from '../i18n';

import { Button } from './button';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from './dialog';

export interface ConfirmDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: string;
  confirmLabel: string;
  /** Default `t('actions.cancel')`. */
  cancelLabel?: string;
  /** Default `'danger'`. */
  tone?: 'danger' | 'default';
  onConfirm: () => void;
  busy?: boolean;
}

export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel,
  cancelLabel,
  tone = 'danger',
  onConfirm,
  busy,
}: ConfirmDialogProps) {
  const { t } = useTranslation('common');
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        size="sm"
        role="alertdialog"
        showCloseButton={false}
        onInteractOutside={(e) => e.preventDefault()}
        onEscapeKeyDown={(e) => {
          if (busy) e.preventDefault();
        }}
      >
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <DialogClose asChild>
            <Button type="button" variant="outline" disabled={busy ?? false}>
              {cancelLabel ?? t('actions.cancel')}
            </Button>
          </DialogClose>
          <Button
            type="button"
            variant={tone === 'danger' ? 'danger' : 'default'}
            loading={busy ?? false}
            onClick={onConfirm}
          >
            {tone === 'danger' && <Trash2Icon aria-hidden="true" />}
            {confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

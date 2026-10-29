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
import { HelpHint, useHelp } from './help-hint';

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
  /** Hide the confirm button (e.g. the action is blocked and only Cancel makes sense). */
  hideConfirm?: boolean;
  /** A (?) beside the title, for the action this dialog confirms (a row or More-menu action
   * has no (?) of its own, #3078). A sibling of the title, so the dialog's name stays the title. */
  helpId?: string | undefined;
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
  hideConfirm,
  helpId,
}: ConfirmDialogProps) {
  const { t } = useTranslation('common');
  const { resolve } = useHelp();
  const titleEl = <DialogTitle>{title}</DialogTitle>;
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
          {/* No wrapper when no (?) renders, so the header keeps its DOM. */}
          {resolve(helpId) ? (
            <div className="flex items-center gap-1">
              {titleEl}
              <HelpHint helpId={helpId} />
            </div>
          ) : (
            titleEl
          )}
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <DialogClose asChild>
            <Button type="button" variant="outline" disabled={busy ?? false}>
              {cancelLabel ?? t('actions.cancel')}
            </Button>
          </DialogClose>
          {!hideConfirm && (
            <Button
              type="button"
              variant={tone === 'danger' ? 'danger' : 'default'}
              loading={busy ?? false}
              onClick={onConfirm}
            >
              {tone === 'danger' && <Trash2Icon aria-hidden="true" />}
              {confirmLabel}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

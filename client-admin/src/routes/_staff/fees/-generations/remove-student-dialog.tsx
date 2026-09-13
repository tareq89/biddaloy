/**
 * [16.3.7] Per-bill "Remove student" action, meant to be rendered from the
 * bills drawer (#654's `batch-bills-drawer.tsx`) — a standalone component
 * here since this ticket doesn't own that drawer file; #654 wires it in by
 * rendering `<RemoveStudentDialog />` next to each bill row.
 *
 * `DELETE /fees/generations/:id/students/:studentId` (#651): free while the
 * student's bill(s) in this batch carry no money; `fees.edit_paid` approval
 * once any of them do. `useApprovedMutation` is what makes "only prompt
 * when the server actually needs it" true — see `ui/src/hooks/approval.tsx`.
 *
 * **Mount this only while `open` is true** (e.g. `{open && <RemoveStudentDialog
 * ... />}`), same reasoning `batch-actions.tsx`'s own doc comment gives for
 * its three dialogs — `useApprovedMutation`'s single approval-modal host
 * goes to whichever instance mounts first and never lets go while mounted,
 * so an always-mounted instance here would starve `batch-actions.tsx`'s
 * kebab-menu mutations (or vice versa) of ever showing the modal.
 */
import { ApiError } from '@biddaloy/ui/api';
import {
  Button,
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@biddaloy/ui/components';
import { useRemoveBatchStudent } from '@biddaloy/ui/hooks';
import { useTranslation } from '@biddaloy/ui/i18n';
import * as React from 'react';

export interface RemoveStudentDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  generationId: string;
  studentId: string;
  studentName: string;
  /** #651's plan step 3: state the consequence explicitly rather than a
   * generic confirmation — true when this student already has a payment
   * or allocation against a bill in this batch, so the confirm copy (and
   * the approval modal, once submitted) both name it up front. */
  hasPayments: boolean;
  onRemoved: () => void;
}

export function RemoveStudentDialog({
  open,
  onOpenChange,
  generationId,
  studentId,
  studentName,
  hasPayments,
  onRemoved,
}: RemoveStudentDialogProps) {
  const { t } = useTranslation('fees');
  const removeBatchStudent = useRemoveBatchStudent();

  React.useEffect(() => {
    if (open) removeBatchStudent.reset();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reset only on open/close transitions
  }, [open]);

  function handleConfirm() {
    removeBatchStudent.mutate(
      { generationId, studentId },
      {
        onSuccess: () => {
          onRemoved();
          onOpenChange(false);
        },
      },
    );
  }

  const isConflict =
    removeBatchStudent.error instanceof ApiError && removeBatchStudent.error.statusCode === 409;

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('generations.removeStudentDialog.title')}</DialogTitle>
            <DialogDescription>
              {t('generations.removeStudentDialog.description', { name: studentName })}
            </DialogDescription>
          </DialogHeader>
          {hasPayments && (
            <p className="text-sm text-muted-foreground">
              {t('generations.removeStudentDialog.approvalNotice', { name: studentName })}
            </p>
          )}
          {removeBatchStudent.isError && (
            <p role="alert" className="text-sm text-destructive">
              {isConflict
                ? t('generations.removeStudentDialog.errorConflict')
                : t('generations.removeStudentDialog.errorMessage')}
            </p>
          )}
          <DialogFooter>
            <DialogClose asChild>
              <Button type="button" variant="outline">
                {t('actions.cancel', { ns: 'common' })}
              </Button>
            </DialogClose>
            <Button
              type="button"
              variant="destructive"
              loading={removeBatchStudent.isPending}
              onClick={handleConfirm}
            >
              {removeBatchStudent.isPending
                ? t('generations.removeStudentDialog.removing')
                : t('generations.removeStudentDialog.confirm')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      {removeBatchStudent.modal}
    </>
  );
}

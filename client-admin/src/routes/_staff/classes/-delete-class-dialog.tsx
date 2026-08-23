/**
 * Delete-class confirmation — [8.11.2]'s "class-delete-blocked" mockup.
 * Three distinct states, not one dialog with a generic error banner:
 *
 *   - Not yet attempted (or attempted and it succeeded): the ordinary
 *     Cancel / destructive-Delete confirm.
 *   - Blocked specifically by a 409 (`ClassService.remove`'s
 *     `ConflictException` — students still enrolled, or sections still
 *     exist): the server's own message (naming the count — the issue's
 *     own "explanation why" AC) in a highlighted box, with the
 *     destructive-Delete button replaced by "Move students" (a real next
 *     step: jumps to this class's Students tab) + "Close" — retrying the
 *     same delete would just fail again, so offering retry would be
 *     misleading.
 *   - Any other failure (500, 403, a dropped connection, ...): a generic
 *     error message alongside the *normal* Cancel / destructive-Delete
 *     footer, same as `-delete-section-dialog.tsx` — these are not
 *     necessarily permanent, so the user keeps a retry path instead of
 *     being steered into "move students", which may not even apply.
 *     `ApiError`/`statusCode` narrowing follows the same convention as
 *     `-sections-panel.tsx`/`-detail/tab-query-state.tsx`.
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
import { useDeleteClass } from '@biddaloy/ui/hooks';
import { useTranslation } from '@biddaloy/ui/i18n';
import { Link } from '@tanstack/react-router';
import * as React from 'react';

export interface DeleteClassDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  classId: string;
  className: string;
  onDeleted: () => void;
}

export function DeleteClassDialog({
  open,
  onOpenChange,
  classId,
  className,
  onDeleted,
}: DeleteClassDialogProps) {
  const { t } = useTranslation('classes');
  const deleteClass = useDeleteClass();

  React.useEffect(() => {
    if (open) deleteClass.reset();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reset only on open/close transitions
  }, [open]);

  function handleConfirm() {
    deleteClass.mutate(classId, { onSuccess: onDeleted });
  }

  // Only a 409 means "retrying will just fail again" — every other
  // failure (500, 403, a dropped connection, ...) keeps the normal
  // Cancel/destructive-Delete footer below instead of being swapped for
  // "Move students", which may not even be the right next step.
  const blocked =
    deleteClass.isError &&
    deleteClass.error instanceof ApiError &&
    deleteClass.error.statusCode === 409;
  const failedNonBlocked = deleteClass.isError && !blocked;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('deleteClassDialog.title')}</DialogTitle>
          {!blocked && (
            <DialogDescription>
              {t('deleteClassDialog.description', { name: className })}
            </DialogDescription>
          )}
        </DialogHeader>

        {blocked && (
          <div className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
            <p role="alert">
              {deleteClass.error instanceof Error
                ? deleteClass.error.message
                : t('deleteClassDialog.errorMessage')}
            </p>
          </div>
        )}

        {failedNonBlocked && (
          // Not a 409 — a generic failure alongside the normal retry
          // footer below, same shape as `-delete-section-dialog.tsx`,
          // rather than the "blocked" state's dead-end button swap.
          <p role="alert" className="text-sm text-destructive">
            {deleteClass.error instanceof Error
              ? deleteClass.error.message
              : t('deleteClassDialog.errorMessage')}
          </p>
        )}

        <DialogFooter>
          {blocked ? (
            <>
              <Button asChild variant="outline">
                <Link
                  to="/classes/$classId"
                  params={{ classId }}
                  search={{ tab: 'students' }}
                  onClick={() => onOpenChange(false)}
                >
                  {t('deleteClassDialog.moveStudents')}
                </Link>
              </Button>
              <DialogClose asChild>
                <Button type="button">{t('deleteClassDialog.close')}</Button>
              </DialogClose>
            </>
          ) : (
            <>
              <DialogClose asChild>
                <Button type="button" variant="outline">
                  {t('actions.cancel', { ns: 'common' })}
                </Button>
              </DialogClose>
              <Button
                type="button"
                variant="destructive"
                loading={deleteClass.isPending}
                onClick={handleConfirm}
              >
                {deleteClass.isPending
                  ? t('deleteClassDialog.deleting')
                  : t('deleteClassDialog.confirm')}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Delete-class confirmation — [8.11.2]'s "class-delete-blocked" mockup.
 * Three distinct states, not one dialog with a generic error banner:
 *
 *   - Not yet attempted (or attempted and it succeeded): the ordinary
 *     Cancel / destructive-Delete confirm.
 *   - Blocked specifically by a 409 (`ClassService.remove`'s
 *     `ConflictException` — students still enrolled, or sections still
 *     exist): a translated sentence (never the server's text, which
 *     embeds the class UUID) in a highlighted box, with the
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
import { Trash2Icon } from 'lucide-react';

const KIND_KEYS = new Set([
  'exams',
  'fee_structures',
  'homework',
  'syllabus_topics',
  'fine_rules',
  'promotion_runs',
  'grading_scales',
]);

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
  const { t, i18n } = useTranslation('classes');
  const deleteClass = useDeleteClass();

  // Callers mount this dialog only while it is open (fresh mutation state).
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

  // Name the real blocker from the 409's `details` (classes.service remove).
  const details = (blocked ? (deleteClass.error as ApiError).details : undefined) ?? {};
  // The Students tab lists current students only, so link there only when some
  // exist; enrollment history alone blocks with its own reason and no link.
  const hasStudents = (Number(details.students_count) || 0) > 0;
  const hasEnrollments = (Number(details.enrollments_count) || 0) > 0;
  const hasSections = (Number(details.sections_count) || 0) > 0;
  let blockedText = '';
  if (blocked) {
    if (hasStudents) blockedText = t('deleteClassDialog.blockedStudents');
    else if (hasEnrollments) blockedText = t('deleteClassDialog.blockedEnrollments');
    else if (hasSections) blockedText = t('deleteClassDialog.blockedSections');
    else {
      const dependents = (details.dependents ?? {}) as Record<string, unknown>;
      const names = Object.keys(dependents).map((k) =>
        KIND_KEYS.has(k) ? t(`deleteClassDialog.kinds.${k}`) : null,
      );
      const kinds = [
        ...names.filter((n): n is string => n !== null),
        ...(names.includes(null) || names.length === 0 ? [t('deleteClassDialog.kinds.other')] : []),
      ];
      blockedText = t('deleteClassDialog.blockedKinds', {
        kinds: new Intl.ListFormat(i18n.language, { type: 'conjunction' }).format(kinds),
      });
    }
  }

  return (
    <Dialog
      open={open}
      // A delete in flight must not be abandoned (Esc / outside / Back).
      onOpenChange={(next) => !(deleteClass.isPending && !next) && onOpenChange(next)}
    >
      <DialogContent
        size="sm"
        role="alertdialog"
        showCloseButton={false}
        onInteractOutside={(e) => e.preventDefault()}
      >
        <DialogHeader>
          <DialogTitle>{t('deleteClassDialog.title')}</DialogTitle>
          {!blocked && (
            <DialogDescription>
              {t('deleteClassDialog.description', { name: className })}
            </DialogDescription>
          )}
        </DialogHeader>

        {blocked && (
          <div className="rounded-md bg-status-overdue-bg p-3 text-status-overdue-fg">
            <p role="alert">{blockedText}</p>
          </div>
        )}

        {failedNonBlocked && (
          // Not a 409 — a generic failure alongside the normal retry
          // footer below, rather than the "blocked" state's dead-end swap.
          <p role="alert" className="text-sm text-destructive">
            {t('deleteClassDialog.errorMessage')}
          </p>
        )}

        <DialogFooter>
          {blocked ? (
            <>
              {hasStudents && (
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
              )}
              <DialogClose asChild>
                <Button type="button">{t('deleteClassDialog.close')}</Button>
              </DialogClose>
            </>
          ) : (
            <>
              <DialogClose asChild>
                <Button type="button" variant="outline" disabled={deleteClass.isPending}>
                  {t('actions.cancel', { ns: 'common' })}
                </Button>
              </DialogClose>
              <Button
                type="button"
                variant="danger"
                loading={deleteClass.isPending}
                onClick={handleConfirm}
              >
                <Trash2Icon aria-hidden="true" />
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

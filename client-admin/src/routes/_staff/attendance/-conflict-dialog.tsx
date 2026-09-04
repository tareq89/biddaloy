/**
 * [9.6] The register's own 409 (`base_version` mismatch — someone else
 * saved a newer version while this draft sat open) surfaces here, never
 * as a raw error toast. Two explicit choices, never auto-resolved:
 *
 * - **Keep mine** — re-submit the local draft against the server's
 *   `current_version` as the new `base_version`, with a *new*
 *   `client_request_id` (this is a fresh write attempt, not a replay of
 *   the failed one).
 * - **Take theirs** — discard the local draft and refetch, showing the
 *   server's current register.
 */
import { AttendanceStatus } from '@biddaloy/shared';
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@biddaloy/ui/components';
import type { Register, RegisterStudent } from '@biddaloy/ui/hooks';
import { useTranslation } from '@biddaloy/ui/i18n';

import type { Draft } from './-roster-marker';

export interface ConflictDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The 409's `details.register` — the server's current state. */
  currentRegister: Register | undefined;
  /** The 409's `details.current_version`. */
  currentVersion: number | undefined;
  draft: Draft;
  students: readonly RegisterStudent[];
  onKeepMine: (currentVersion: number) => void;
  onTakeTheirs: () => void;
}

function statusOf(draft: Draft, studentId: string): AttendanceStatus | null {
  return draft[studentId]?.status ?? null;
}

export function ConflictDialog({
  open,
  onOpenChange,
  currentRegister,
  currentVersion,
  draft,
  students,
  onKeepMine,
  onTakeTheirs,
}: ConflictDialogProps) {
  const { t } = useTranslation('attendance');

  const theirStatusByStudent = new Map(
    (currentRegister?.students ?? []).map((student) => [student.student_id, student.status]),
  );

  // Only the students whose local mark disagrees with the server's
  // current one — the plan's own AC ("showing only students whose status
  // differs"), so a 40-student conflict doesn't dump the whole roster.
  const diffs = students
    .map((student) => ({
      student,
      mine: statusOf(draft, student.student_id),
      theirs: theirStatusByStudent.get(student.student_id) ?? null,
    }))
    .filter(({ mine, theirs }) => mine !== theirs);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('conflict.title')}</DialogTitle>
          <DialogDescription>{t('conflict.explanation')}</DialogDescription>
        </DialogHeader>
        {diffs.length > 0 && (
          <table className="w-full text-sm">
            <caption className="sr-only">{t('conflict.title')}</caption>
            <thead>
              <tr className="text-left text-muted-foreground">
                <th scope="col">{t('conflict.columnStudent')}</th>
                <th scope="col">{t('conflict.columnYours')}</th>
                <th scope="col">{t('conflict.columnTheirs')}</th>
              </tr>
            </thead>
            <tbody>
              {diffs.map(({ student, mine, theirs }) => (
                <tr key={student.student_id}>
                  <td>{student.full_name}</td>
                  <td>{mine ? t(`statusControl.status.${mine}`) : t('statusControl.unmarked')}</td>
                  <td>
                    {theirs ? t(`statusControl.status.${theirs}`) : t('statusControl.unmarked')}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <DialogFooter>
          <Button type="button" variant="outline" onClick={onTakeTheirs}>
            {t('conflict.takeTheirs')}
          </Button>
          <Button
            type="button"
            disabled={currentVersion === undefined}
            onClick={() => currentVersion !== undefined && onKeepMine(currentVersion)}
          >
            {t('conflict.keepMine')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

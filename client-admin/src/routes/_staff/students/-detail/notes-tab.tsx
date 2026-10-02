/**
 * [39.3.4] Student detail's "Notes" tab — staff-only notes (D4, D29):
 * list, add, delete. No edit. Delete is offered to the note's author or an
 * ADMIN only (the server enforces the same rule; this just hides the
 * button). Shell/`TabQueryState` cloned from `fines-tab.tsx`, dialogs from
 * `waive-fine-dialog.tsx`. Notes render as cards at every width — they are
 * free text, a table adds nothing.
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
  SkeletonTable,
  Textarea,
} from '@biddaloy/ui/components';
import {
  useActiveRole,
  useAddStudentNote,
  useCurrentUserId,
  useDeleteStudentNote,
  useStudentNotes,
  type StudentNote,
} from '@biddaloy/ui/hooks';
import { useRegionConfig, useTranslation } from '@biddaloy/ui/i18n';
import { formatDate } from '@biddaloy/ui/utils';
import * as React from 'react';

import { TabQueryState } from './tab-query-state';

/** Matches the server DTO's `@Length(1, 2000)`. */
const NOTE_MAX_LENGTH = 2000;

export interface NotesTabProps {
  studentId: string;
}

export function NotesTab({ studentId }: NotesTabProps) {
  const { t } = useTranslation('student-notes');
  const query = useStudentNotes(studentId);
  const currentUserId = useCurrentUserId();
  const isAdmin = useActiveRole() === 'ADMIN';
  const [addOpen, setAddOpen] = React.useState(false);
  const [deleteId, setDeleteId] = React.useState<string | null>(null);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex justify-end">
        <Button type="button" onClick={() => setAddOpen(true)}>
          {t('add')}
        </Button>
      </div>

      <TabQueryState
        query={query}
        forbiddenMessage={t('detail.forbidden', { ns: 'students' })}
        errorMessage={t('errorMessage')}
        skeleton={<SkeletonTable rows={3} columns={1} />}
      >
        {(notes) =>
          notes.length === 0 ? (
            <div className="flex flex-col items-center gap-1 rounded-lg border border-dashed border-border-subtle p-8 text-center">
              <p className="text-sm font-medium">{t('empty')}</p>
              <p className="text-sm text-muted-foreground">{t('emptyDescription')}</p>
            </div>
          ) : (
            <ul className="flex flex-col gap-2">
              {notes.map((note) => (
                <NoteCard
                  key={note.id}
                  note={note}
                  canDelete={
                    isAdmin || (currentUserId !== null && note.author.id === currentUserId)
                  }
                  onDelete={() => setDeleteId(note.id)}
                />
              ))}
            </ul>
          )
        }
      </TabQueryState>

      <AddNoteDialog studentId={studentId} open={addOpen} onOpenChange={setAddOpen} />
      {deleteId !== null && (
        <DeleteNoteDialog
          studentId={studentId}
          noteId={deleteId}
          onOpenChange={(open) => {
            if (!open) setDeleteId(null);
          }}
        />
      )}
    </div>
  );
}

function NoteCard({
  note,
  canDelete,
  onDelete,
}: {
  note: StudentNote;
  canDelete: boolean;
  onDelete: () => void;
}) {
  const { t } = useTranslation('student-notes');
  const regionConfig = useRegionConfig();
  return (
    <li className="flex flex-col gap-2 rounded-lg border border-border-subtle p-3">
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground">
          <span className="font-medium text-foreground">
            {note.author.name || t('unknownAuthor')}
          </span>{' '}
          · {formatDate(new Date(note.created_at), regionConfig)}
        </p>
        {canDelete && (
          <Button type="button" size="sm" variant="outline" onClick={onDelete}>
            {t('delete')}
          </Button>
        )}
      </div>
      {typeof note.rating === 'number' && (
        <p
          className="text-sm text-primary"
          role="img"
          aria-label={t('ratingShown', { count: note.rating })}
        >
          {'★'.repeat(note.rating)}
          <span className="text-muted-foreground">{'★'.repeat(5 - note.rating)}</span>
        </p>
      )}
      <p className="text-sm break-words whitespace-pre-wrap">{note.body}</p>
    </li>
  );
}

function AddNoteDialog({
  studentId,
  open,
  onOpenChange,
}: {
  studentId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { t } = useTranslation('student-notes');
  const addNote = useAddStudentNote(studentId);
  const [body, setBody] = React.useState('');
  const [rating, setRating] = React.useState<number | null>(null);

  React.useEffect(() => {
    if (open) {
      addNote.reset();
      setBody('');
      setRating(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reset only when the dialog opens
  }, [open]);

  const trimmed = body.trim();
  const canSubmit = trimmed.length > 0 && !addNote.isPending;

  function submit() {
    if (!canSubmit) return;
    addNote.mutate(rating === null ? { body: trimmed } : { body: trimmed, rating }, {
      onSuccess: () => onOpenChange(false),
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('addTitle')}</DialogTitle>
          <DialogDescription>{t('addDescription')}</DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-1.5">
          <label htmlFor="student-note-body" className="text-sm font-medium">
            {t('bodyLabel')}
          </label>
          <Textarea
            id="student-note-body"
            value={body}
            onChange={(event) => setBody(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
                event.preventDefault();
                submit();
              }
            }}
            maxLength={NOTE_MAX_LENGTH}
            rows={5}
            aria-describedby="student-note-hint"
          />
          <p id="student-note-hint" className="text-xs text-muted-foreground">
            {t('hint')}
          </p>
        </div>

        <div role="group" aria-label={t('ratingLabel')} className="flex flex-col gap-1.5">
          <span className="text-sm font-medium">{t('ratingLabel')}</span>
          <div className="flex gap-1">
            {[1, 2, 3, 4, 5].map((value) => (
              <button
                key={value}
                type="button"
                aria-pressed={rating === value}
                aria-label={t('ratingStar', { count: value })}
                onClick={() => setRating(rating === value ? null : value)}
                className={`rounded-sm px-1 text-2xl leading-none focus-visible:outline-2 focus-visible:outline-ring ${
                  value <= (rating ?? 0) ? 'text-primary' : 'text-muted-foreground'
                }`}
              >
                <span aria-hidden="true">★</span>
              </button>
            ))}
          </div>
        </div>

        {addNote.isError && (
          <p role="alert" className="text-sm text-destructive">
            {t('saveError')}
          </p>
        )}

        <DialogFooter>
          <DialogClose asChild>
            <Button type="button" variant="outline">
              {t('actions.cancel', { ns: 'common' })}
            </Button>
          </DialogClose>
          <Button type="button" disabled={!canSubmit} loading={addNote.isPending} onClick={submit}>
            {addNote.isPending ? t('saving') : t('save')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function DeleteNoteDialog({
  studentId,
  noteId,
  onOpenChange,
}: {
  studentId: string;
  noteId: string;
  onOpenChange: (open: boolean) => void;
}) {
  const { t } = useTranslation('student-notes');
  const deleteNote = useDeleteStudentNote(studentId);

  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('deleteTitle')}</DialogTitle>
          <DialogDescription>{t('deleteDescription')}</DialogDescription>
        </DialogHeader>

        {deleteNote.isError && (
          <p role="alert" className="text-sm text-destructive">
            {t('deleteError')}
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
            loading={deleteNote.isPending}
            onClick={() =>
              deleteNote.mutate(noteId, {
                onSuccess: () => onOpenChange(false),
                // 404 = already deleted elsewhere; nothing left to do.
                onError: (error) => {
                  if (error instanceof ApiError && error.statusCode === 404) onOpenChange(false);
                },
              })
            }
          >
            {deleteNote.isPending ? t('deleting') : t('delete')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

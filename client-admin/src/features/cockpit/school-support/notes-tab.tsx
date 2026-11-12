/**
 * #3822 School 360, "Notes" tab: dated owner notes about one school, an add box (2000 characters,
 * counter) and delete on your own notes. The Login as dialog (#3819) reads the same list.
 * Failures are fixed sentences; the typed text is never echoed back (Rule 23).
 */
import {
  Button,
  Card,
  ConfirmDialog,
  EmptyState,
  ErrorState,
  Skeleton,
  Textarea,
  toast,
} from '@biddaloy/ui/components';
import {
  useAddSchoolNote,
  useCurrentUserId,
  useDeleteSchoolNote,
  useSchoolNotes,
  type SchoolNote,
} from '@biddaloy/ui/hooks';
import { useRegionConfig, useTranslation } from '@biddaloy/ui/i18n';
import { formatDateTime, formatNumber } from '@biddaloy/ui/utils';
import * as React from 'react';

export const NOTE_MAX = 2000;

export interface NotesTabProps {
  schoolId: string;
  /** Defaults to the signed-in owner; set it in stories and tests. */
  currentUserId?: string | null;
}

export function NotesTab({ schoolId, currentUserId }: NotesTabProps) {
  const { t } = useTranslation('schoolSupport');
  const config = useRegionConfig();
  const me = useCurrentUserId();
  const mine = currentUserId === undefined ? me : currentUserId;
  const notes = useSchoolNotes(schoolId);
  const add = useAddSchoolNote(schoolId);
  const remove = useDeleteSchoolNote(schoolId);
  const [text, setText] = React.useState('');
  const [toDelete, setToDelete] = React.useState<SchoolNote | null>(null);
  const [addFailed, setAddFailed] = React.useState(false);
  const [deleteFailed, setDeleteFailed] = React.useState(false);

  const trimmed = text.trim();
  const tooLong = text.length > NOTE_MAX;

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!trimmed || tooLong) return;
    setAddFailed(false);
    try {
      await add.mutateAsync({ text: trimmed });
      setText('');
      toast.success(t('notes.added'));
    } catch {
      setAddFailed(true);
    }
  }

  async function confirmDelete() {
    if (!toDelete) return;
    setDeleteFailed(false);
    try {
      await remove.mutateAsync({ noteId: toDelete.id });
      setToDelete(null);
      toast.success(t('notes.deleted'));
    } catch {
      setDeleteFailed(true);
    }
  }

  return (
    <div className="space-y-4">
      <Card className="p-4 md:p-5">
        <form onSubmit={(e) => void submit(e)} className="space-y-2" noValidate>
          <label htmlFor="school-note" className="text-body-sm font-medium">
            {t('notes.label')}
          </label>
          <Textarea
            id="school-note"
            rows={3}
            value={text}
            placeholder={t('notes.placeholder')}
            aria-invalid={tooLong}
            aria-describedby="school-note-count"
            onChange={(e) => setText(e.target.value)}
          />
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span
              id="school-note-count"
              className={
                tooLong ? 'text-caption text-destructive' : 'text-caption text-muted-foreground'
              }
            >
              {t('notes.counter', {
                n: formatNumber(text.length, config),
                max: formatNumber(NOTE_MAX, config),
              })}
            </span>
            <Button type="submit" disabled={!trimmed || tooLong} loading={add.isPending}>
              {t('notes.add')}
            </Button>
          </div>
          {tooLong && (
            <p role="alert" className="text-caption text-destructive">
              {t('notes.errors.tooLong')}
            </p>
          )}
          {addFailed && (
            <p role="alert" className="text-caption text-destructive">
              {t('notes.errors.add')}
            </p>
          )}
        </form>
      </Card>

      {notes.isLoading ? (
        <Skeleton className="h-24 w-full" />
      ) : notes.isError ? (
        <ErrorState
          message={t('notes.errors.load')}
          retryLabel={t('notes.retry')}
          onRetry={() => void notes.refetch()}
        />
      ) : (notes.data ?? []).length === 0 ? (
        <EmptyState title={t('notes.empty')} explanation={t('notes.emptyExplanation')} />
      ) : (
        <ul className="space-y-3" aria-label={t('notes.title')}>
          {(notes.data ?? []).map((note) => (
            <li key={note.id}>
              <Card className="space-y-2 p-4">
                <p className="text-body break-words whitespace-pre-wrap">{note.text}</p>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <time className="text-caption text-muted-foreground" dateTime={note.createdAt}>
                    {formatDateTime(note.createdAt, config)}
                  </time>
                  {mine !== null && note.authorId === mine && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => {
                        setDeleteFailed(false);
                        setToDelete(note);
                      }}
                    >
                      {t('notes.delete')}
                    </Button>
                  )}
                </div>
              </Card>
            </li>
          ))}
        </ul>
      )}

      <ConfirmDialog
        open={toDelete !== null}
        onOpenChange={(open) => {
          if (!open && !remove.isPending) setToDelete(null);
        }}
        title={t('notes.deleteTitle')}
        description={deleteFailed ? t('notes.errors.delete') : t('notes.deleteDescription')}
        confirmLabel={t('notes.delete')}
        busy={remove.isPending}
        onConfirm={() => void confirmDelete()}
      />
    </div>
  );
}

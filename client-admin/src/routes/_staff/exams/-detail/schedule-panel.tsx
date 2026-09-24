/**
 * Schedule tab — [19.11.1]. One row per scheduled subject (date, start,
 * end, venue), sorted by date then start time. Keyboard-first inline
 * editing: click or press Enter on a cell to edit it, Enter commits,
 * Escape cancels, Tab moves to the next cell. `components-panel.tsx` (the
 * Setup tab) has no inline-edit pattern to clone — it only supports
 * add/delete — so this panel designs its own minimal one rather than a
 * per-row modal, per the issue's "keyboard-editable, not a modal" rule.
 */
import { Permission } from '@biddaloy/shared';
import {
  Button,
  ErrorState,
  Input,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Skeleton,
} from '@biddaloy/ui/components';
import {
  useClassSubjects,
  useCreateExamSchedule,
  useDeleteExamSchedule,
  useExamSchedule,
  useHasPermission,
  useUpdateExamSchedule,
  type ExamScheduleRow,
} from '@biddaloy/ui/hooks';
import { useTranslation } from '@biddaloy/ui/i18n';
import * as React from 'react';

export interface SchedulePanelProps {
  examId: string;
  classId: string;
  academicYearId: string;
}

type ColumnKey = 'date' | 'starts_at' | 'ends_at' | 'venue';

interface EditingCell {
  rowId: string;
  column: ColumnKey;
}

export function SchedulePanel({ examId, classId, academicYearId }: SchedulePanelProps) {
  const { t } = useTranslation('exams');
  const canManage = useHasPermission(Permission.EXAM_MANAGE);
  const classSubjectsQuery = useClassSubjects(classId, academicYearId);
  const scheduleQuery = useExamSchedule(examId);
  const createSchedule = useCreateExamSchedule(examId);
  const updateSchedule = useUpdateExamSchedule(examId);
  const deleteSchedule = useDeleteExamSchedule(examId);

  const [editing, setEditing] = React.useState<EditingCell | null>(null);
  const [draft, setDraft] = React.useState('');
  const [warnings, setWarnings] = React.useState<string[]>([]);
  const [addSubjectId, setAddSubjectId] = React.useState<string | undefined>(undefined);
  const inputRef = React.useRef<HTMLInputElement>(null);

  const rows = React.useMemo(
    () =>
      (scheduleQuery.data ?? [])
        .slice()
        .sort((a, b) =>
          a.date !== b.date ? a.date.localeCompare(b.date) : a.starts_at.localeCompare(b.starts_at),
        ),
    [scheduleQuery.data],
  );

  const subjects = classSubjectsQuery.data ?? [];
  const scheduledSubjectIds = new Set(rows.map((r) => r.subject_id));
  const unscheduledSubjects = subjects.filter((s) => !scheduledSubjectIds.has(s.subject_id));

  React.useEffect(() => {
    if (editing) inputRef.current?.focus();
  }, [editing]);

  function startEdit(row: ExamScheduleRow, column: ColumnKey) {
    if (!canManage) return;
    setEditing({ rowId: row.id, column });
    setDraft(String(row[column] ?? ''));
  }

  function cancelEdit() {
    setEditing(null);
    setDraft('');
  }

  function commitEdit(row: ExamScheduleRow) {
    if (!editing) return;
    const value = draft.trim();
    updateSchedule.mutate(
      {
        id: row.id,
        input: { [editing.column]: editing.column === 'venue' ? value || null : value },
      },
      {
        onSuccess: (result) => setWarnings(result.warnings),
      },
    );
    setEditing(null);
    setDraft('');
  }

  function handleCellKeyDown(event: React.KeyboardEvent, row: ExamScheduleRow, column: ColumnKey) {
    if (editing) return;
    if (event.key === 'Enter') {
      event.preventDefault();
      startEdit(row, column);
    }
  }

  function handleInputKeyDown(event: React.KeyboardEvent<HTMLInputElement>, row: ExamScheduleRow) {
    if (event.key === 'Enter') {
      event.preventDefault();
      commitEdit(row);
    } else if (event.key === 'Escape') {
      event.preventDefault();
      cancelEdit();
    }
    // Tab is left to the browser's default focus movement — committing on
    // blur (below) means Tab both moves focus and saves the cell.
  }

  function handleAdd() {
    if (!addSubjectId) return;
    createSchedule.mutate(
      {
        subject_id: addSubjectId,
        date: new Date().toISOString().slice(0, 10),
        starts_at: '09:00',
        ends_at: '11:00',
      },
      {
        onSuccess: (result) => {
          setWarnings(result.warnings);
          setAddSubjectId(undefined);
        },
      },
    );
  }

  function subjectName(row: ExamScheduleRow): string {
    return (
      row.subject?.name_en ??
      subjects.find((s) => s.subject_id === row.subject_id)?.subject.name_en ??
      row.subject_id
    );
  }

  function renderCell(row: ExamScheduleRow, column: ColumnKey) {
    const isEditing = editing?.rowId === row.id && editing.column === column;
    if (isEditing) {
      return (
        <Input
          ref={inputRef}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => handleInputKeyDown(e, row)}
          onBlur={() => commitEdit(row)}
          aria-label={t(`schedulePanel.column${capitalize(column)}`)}
          type={
            column === 'date'
              ? 'date'
              : column === 'starts_at' || column === 'ends_at'
                ? 'time'
                : 'text'
          }
        />
      );
    }
    const display = row[column] ?? '—';
    return (
      <button
        type="button"
        className="w-full rounded px-1 py-0.5 text-left hover:bg-muted focus:outline focus:outline-2 focus:outline-primary"
        onClick={() => startEdit(row, column)}
        onKeyDown={(e) => handleCellKeyDown(e, row, column)}
        disabled={!canManage}
      >
        {display}
      </button>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {scheduleQuery.isLoading && <Skeleton className="h-24 w-full" />}
      {scheduleQuery.isError && (
        <ErrorState
          message={t('schedulePanel.loadError')}
          onRetry={() => void scheduleQuery.refetch()}
        />
      )}

      {warnings.length > 0 && (
        <div
          role="alert"
          className="rounded-md border border-status-due-fg bg-status-due-bg p-3 text-sm text-status-due-fg"
        >
          {warnings.map((w, i) => (
            <p key={i}>{w}</p>
          ))}
        </div>
      )}

      {!scheduleQuery.isLoading && !scheduleQuery.isError && (
        <table className="w-full text-sm">
          <caption className="sr-only">{t('schedulePanel.tableCaption')}</caption>
          <thead>
            <tr className="border-b text-left text-muted-foreground">
              <th className="py-2">{t('schedulePanel.columnSubject')}</th>
              <th className="py-2">{t('schedulePanel.columnDate')}</th>
              <th className="py-2">{t('schedulePanel.columnStartsAt')}</th>
              <th className="py-2">{t('schedulePanel.columnEndsAt')}</th>
              <th className="py-2">{t('schedulePanel.columnVenue')}</th>
              {canManage && <th className="py-2">{t('schedulePanel.columnActions')}</th>}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id} className="border-b">
                <td className="py-2">{subjectName(row)}</td>
                <td className="py-2">{renderCell(row, 'date')}</td>
                <td className="py-2">{renderCell(row, 'starts_at')}</td>
                <td className="py-2">{renderCell(row, 'ends_at')}</td>
                <td className="py-2">{renderCell(row, 'venue')}</td>
                {canManage && (
                  <td className="py-2">
                    <button
                      type="button"
                      onClick={() => deleteSchedule.mutate(row.id)}
                      className="text-sm font-medium text-destructive underline"
                    >
                      {t('schedulePanel.remove')}
                    </button>
                  </td>
                )}
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td colSpan={6} className="py-4 text-center text-muted-foreground">
                  {t('schedulePanel.empty')}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      )}

      {canManage && unscheduledSubjects.length > 0 && (
        <div className="flex flex-wrap items-end gap-2 rounded-md border p-3">
          <div className="flex flex-col gap-1.5">
            <span className="text-sm font-medium">{t('schedulePanel.addSubjectLabel')}</span>
            <Select value={addSubjectId ?? ''} onValueChange={setAddSubjectId}>
              <SelectTrigger aria-label={t('schedulePanel.addSubjectLabel')}>
                <SelectValue placeholder={t('schedulePanel.addSubjectPlaceholder')} />
              </SelectTrigger>
              <SelectContent>
                {unscheduledSubjects.map((s) => (
                  <SelectItem key={s.subject_id} value={s.subject_id}>
                    {s.subject.name_en}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <Button
            type="button"
            onClick={handleAdd}
            loading={createSchedule.isPending}
            disabled={!addSubjectId}
          >
            {t('schedulePanel.add')}
          </Button>
        </div>
      )}
    </div>
  );
}

function capitalize(s: string): string {
  return (
    s.charAt(0).toUpperCase() + s.slice(1).replace(/_([a-z])/g, (_, c: string) => c.toUpperCase())
  );
}

/**
 * Schedule tab — [19.11.1], redesigned in [31.4.exams-2b]. One row per scheduled
 * subject (date, start, end, venue), sorted by date then start time. Date and
 * time cells are the kit `DatePicker` / `TimeInput` (picking a value saves the
 * cell); the venue is an inline `Input` (Enter saves, Esc cancels, blur saves),
 * so every cell stays keyboard-editable without a modal. Time clashes between
 * rows on one date are flagged client-side — the server's English overlap
 * warnings are never shown.
 */
import { Permission } from '@biddaloy/shared';
import {
  Button,
  ConfirmDialog,
  DataTable,
  DatePicker,
  Input,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Skeleton,
  StatusBadge,
  TimeInput,
  ErrorState,
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
import { useRegionConfig, useTranslation } from '@biddaloy/ui/i18n';
import { parseDate, toIsoDate } from '@biddaloy/ui/utils';
import * as React from 'react';

import { subjectLabel } from './subject-label';

export interface SchedulePanelProps {
  examId: string;
  classId: string;
  academicYearId: string;
}

const CARD = 'rounded-lg border border-border-subtle bg-surface shadow-e1';
const hhmm = (value: string) => value.slice(0, 5);

/** ponytail: `DataTable`'s `td` handles Space / arrows / Home / End for grid navigation and
 * the events bubble up from inputs and portalled pickers inside a cell, which breaks typing
 * and option navigation. Stop them here. Shared request: the `td` handler should ignore events
 * whose target is not the `td` itself. */
function Cell({ children }: { children: React.ReactNode }) {
  return (
    // eslint-disable-next-line jsx-a11y/no-static-element-interactions -- only stops key events bubbling to the table cell
    <div onKeyDown={(e) => e.stopPropagation()}>{children}</div>
  );
}

/** Venue is the one free-text cell; it keeps its own edit state. */
function VenueCell({
  row,
  label,
  canManage,
  onSave,
}: {
  row: ExamScheduleRow;
  label: string;
  canManage: boolean;
  onSave: (venue: string | null) => void;
}) {
  const { t } = useTranslation('exams');
  const [editing, setEditing] = React.useState(false);
  const [draft, setDraft] = React.useState('');
  // Unmounting the focused input can fire `blur` after Enter or Escape; this
  // makes sure one edit is saved (or dropped) exactly once.
  const handled = React.useRef(false);
  const inputRef = React.useRef<HTMLInputElement>(null);

  React.useEffect(() => {
    if (editing) inputRef.current?.focus();
  }, [editing]);

  function commit() {
    if (handled.current) return;
    handled.current = true;
    onSave(draft.trim() || null);
    setEditing(false);
  }

  if (editing) {
    return (
      <Input
        ref={inputRef}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            commit();
          } else if (e.key === 'Escape') {
            e.preventDefault();
            handled.current = true;
            setEditing(false);
          }
        }}
        onBlur={commit}
        aria-label={t('schedulePanel.columnVenue')}
      />
    );
  }
  return (
    <button
      type="button"
      className="min-h-11 w-full rounded px-1 text-start hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring md:min-h-8"
      onClick={() => {
        handled.current = false;
        setDraft(row.venue ?? '');
        setEditing(true);
      }}
      disabled={!canManage}
      aria-label={`${row.venue ?? '—'}, ${label}`}
    >
      {row.venue ?? '—'}
    </button>
  );
}

export function SchedulePanel({ examId, classId, academicYearId }: SchedulePanelProps) {
  const { t, i18n } = useTranslation('exams');
  const config = useRegionConfig();
  const canManage = useHasPermission(Permission.EXAM_MANAGE);
  const classSubjectsQuery = useClassSubjects(classId, academicYearId);
  const scheduleQuery = useExamSchedule(examId);
  const createSchedule = useCreateExamSchedule(examId);
  const updateSchedule = useUpdateExamSchedule(examId);
  const deleteSchedule = useDeleteExamSchedule(examId);

  const [pendingRemove, setPendingRemove] = React.useState<ExamScheduleRow | null>(null);
  const [addSubjectId, setAddSubjectId] = React.useState<string | undefined>(undefined);
  const [addDate, setAddDate] = React.useState<Date | undefined>(() => new Date());
  const [addStart, setAddStart] = React.useState('09:00');
  const [addEnd, setAddEnd] = React.useState('11:00');

  const subjects = classSubjectsQuery.data ?? [];

  function subjectName(row: ExamScheduleRow): string {
    const subject =
      row.subject ?? subjects.find((s) => s.subject_id === row.subject_id)?.subject ?? null;
    return subject ? subjectLabel(subject, i18n.language) : '—';
  }

  const rows = React.useMemo(() => {
    const sorted = (scheduleQuery.data ?? [])
      .slice()
      .sort((a, b) =>
        a.date !== b.date ? a.date.localeCompare(b.date) : a.starts_at.localeCompare(b.starts_at),
      );
    // A clash: another row on the same date whose time range overlaps this one's.
    return sorted.map((row) => ({
      row,
      clashes: sorted
        .filter(
          (other) =>
            other.id !== row.id &&
            other.date === row.date &&
            hhmm(row.starts_at) < hhmm(other.ends_at) &&
            hhmm(other.starts_at) < hhmm(row.ends_at),
        )
        .map(subjectName),
    }));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- subjectName only reads subjects + language
  }, [scheduleQuery.data, subjects, i18n.language]);

  const scheduledSubjectIds = new Set((scheduleQuery.data ?? []).map((r) => r.subject_id));
  const unscheduledSubjects = subjects.filter((s) => !scheduledSubjectIds.has(s.subject_id));

  const save = (id: string, input: Parameters<typeof updateSchedule.mutate>[0]['input']) =>
    updateSchedule.mutate({ id, input });

  function handleAdd(event: React.FormEvent) {
    event.preventDefault();
    if (!addSubjectId || !addDate) return;
    createSchedule.mutate(
      {
        subject_id: addSubjectId,
        date: toIsoDate(addDate),
        starts_at: addStart,
        ends_at: addEnd,
      },
      { onSuccess: () => setAddSubjectId(undefined) },
    );
  }

  type Item = (typeof rows)[number];
  const cellLabel = (item: Item, column: string) =>
    t('schedulePanel.editCell', { column, subject: subjectName(item.row) });

  return (
    <div className="flex flex-col gap-6">
      {scheduleQuery.isLoading && <Skeleton className="h-24 w-full" />}
      {scheduleQuery.isError && (
        <ErrorState
          message={t('schedulePanel.loadError')}
          onRetry={() => void scheduleQuery.refetch()}
        />
      )}

      {(updateSchedule.isError || createSchedule.isError) && (
        <p role="alert" className="text-sm text-destructive">
          {t('schedulePanel.saveError')}
        </p>
      )}

      {!scheduleQuery.isLoading && !scheduleQuery.isError && (
        // ponytail: DataTable's "Total n" footer stays; add a footer slot only if it ever clutters.
        <DataTable
          tableId="exam-schedule"
          caption={t('schedulePanel.tableCaption')}
          paginated={false}
          columns={[
            {
              id: 'subject',
              header: t('schedulePanel.columnSubject'),
              accessorFn: ({ row, clashes }: Item) => (
                <span className="flex flex-col gap-1">
                  <span className="flex flex-wrap items-center gap-2">
                    <span className="font-medium">{subjectName(row)}</span>
                    {clashes.length > 0 && (
                      <StatusBadge tone="warning" label={t('schedulePanel.overlapBadge')} />
                    )}
                  </span>
                  {clashes.length > 0 && (
                    // ponytail: ', ' joins the names; a locale-aware list needs a shared formatter.
                    <span className="text-caption text-text-secondary">
                      {t('schedulePanel.overlapWith', { subjects: clashes.join(', ') })}
                    </span>
                  )}
                </span>
              ),
              card: 'title',
            },
            {
              id: 'date',
              header: t('schedulePanel.columnDate'),
              accessorFn: (item: Item) => (
                <Cell>
                  <DatePicker
                    config={config}
                    value={parseDate(item.row.date.slice(0, 10))}
                    onValueChange={(date) => date && save(item.row.id, { date: toIsoDate(date) })}
                    disabled={!canManage}
                    aria-label={cellLabel(item, t('schedulePanel.columnDate'))}
                  />
                </Cell>
              ),
            },
            {
              id: 'starts_at',
              header: t('schedulePanel.columnStartsAt'),
              accessorFn: (item: Item) => (
                <Cell>
                  <TimeInput
                    value={hhmm(item.row.starts_at)}
                    onValueChange={(value) => save(item.row.id, { starts_at: value })}
                    stepMinutes={15}
                    disabled={!canManage}
                    aria-label={cellLabel(item, t('schedulePanel.columnStartsAt'))}
                  />
                </Cell>
              ),
            },
            {
              id: 'ends_at',
              header: t('schedulePanel.columnEndsAt'),
              accessorFn: (item: Item) => (
                <Cell>
                  <TimeInput
                    value={hhmm(item.row.ends_at)}
                    onValueChange={(value) => save(item.row.id, { ends_at: value })}
                    stepMinutes={15}
                    disabled={!canManage}
                    aria-label={cellLabel(item, t('schedulePanel.columnEndsAt'))}
                  />
                </Cell>
              ),
            },
            {
              id: 'venue',
              header: t('schedulePanel.columnVenue'),
              accessorFn: (item: Item) => (
                <Cell>
                  <VenueCell
                    row={item.row}
                    label={cellLabel(item, t('schedulePanel.columnVenue'))}
                    canManage={canManage}
                    onSave={(venue) => save(item.row.id, { venue })}
                  />
                </Cell>
              ),
            },
          ]}
          rowActions={(item: Item) => [
            {
              intent: 'remove',
              label: t('schedulePanel.remove'),
              allowed: canManage,
              onClick: () => setPendingRemove(item.row),
            },
          ]}
          data={rows}
          getRowId={(item: Item) => item.row.id}
          sorting={null}
          onSortingChange={() => {}}
          page={1}
          pageSize={Math.max(rows.length, 1)}
          totalCount={rows.length}
          onPageChange={() => {}}
          emptyState={{
            title: t('schedulePanel.emptyTitle'),
            explanation: t('schedulePanel.emptyText'),
          }}
        />
      )}

      {canManage && unscheduledSubjects.length > 0 && (
        <form onSubmit={handleAdd} className={`${CARD} p-4 md:p-5`}>
          <h2 className="text-h2">{t('schedulePanel.addTitle')}</h2>
          <div className="mt-4 grid gap-4 md:grid-cols-12 md:items-end">
            <div className="flex flex-col gap-1.5 md:col-span-4">
              <Label htmlFor="schedule-add-subject">{t('schedulePanel.addSubjectLabel')}</Label>
              <Select value={addSubjectId ?? ''} onValueChange={setAddSubjectId}>
                <SelectTrigger id="schedule-add-subject" className="w-full">
                  <SelectValue placeholder={t('schedulePanel.addSubjectPlaceholder')} />
                </SelectTrigger>
                <SelectContent>
                  {unscheduledSubjects.map((s) => (
                    <SelectItem key={s.subject_id} value={s.subject_id}>
                      {subjectLabel(s.subject, i18n.language)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex flex-col gap-1.5 md:col-span-3">
              <Label>{t('schedulePanel.columnDate')}</Label>
              <DatePicker
                config={config}
                value={addDate}
                onValueChange={setAddDate}
                aria-label={t('schedulePanel.columnDate')}
              />
            </div>
            <div className="flex flex-col gap-1.5 md:col-span-2">
              <Label>{t('schedulePanel.columnStartsAt')}</Label>
              <TimeInput
                value={addStart}
                onValueChange={setAddStart}
                stepMinutes={15}
                aria-label={t('schedulePanel.columnStartsAt')}
              />
            </div>
            <div className="flex flex-col gap-1.5 md:col-span-2">
              <Label>{t('schedulePanel.columnEndsAt')}</Label>
              <TimeInput
                value={addEnd}
                onValueChange={setAddEnd}
                stepMinutes={15}
                aria-label={t('schedulePanel.columnEndsAt')}
              />
            </div>
            <Button
              type="submit"
              variant="outline"
              className="w-full md:col-span-1"
              loading={createSchedule.isPending}
              disabled={!addSubjectId || !addDate}
            >
              {t('schedulePanel.add')}
            </Button>
          </div>
        </form>
      )}

      <ConfirmDialog
        open={pendingRemove !== null}
        onOpenChange={(open) => {
          if (!open) {
            setPendingRemove(null);
            deleteSchedule.reset();
          }
        }}
        title={t('schedulePanel.removeTitle')}
        description={`${t('schedulePanel.removeDescription', {
          subject: pendingRemove ? subjectName(pendingRemove) : '',
        })}${deleteSchedule.isError ? ` ${t('schedulePanel.removeError')}` : ''}`}
        confirmLabel={t('schedulePanel.removeConfirm')}
        busy={deleteSchedule.isPending}
        onConfirm={() =>
          pendingRemove &&
          deleteSchedule.mutate(pendingRemove.id, { onSuccess: () => setPendingRemove(null) })
        }
      />
    </div>
  );
}

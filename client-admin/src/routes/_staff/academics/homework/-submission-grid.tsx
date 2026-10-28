/**
 * [22.4.2] One row per student against a `HomeworkAssignment`. Column set depends on
 * `Homework.grading_mode` (D11): TICK a checkbox, PARTIAL a 3-state radio group, MARKS a number.
 * One Save sends every dirty row at once. `$homeworkId.tsx` mounts it (#2899).
 *
 * `rows` MUST be memoised by the caller: the draft re-baselines whenever its identity changes
 * (so a background refetch with really-changed data drops unsaved edits; accepted).
 */
import { HomeworkGradingMode, HomeworkSubmissionStatus } from '@biddaloy/shared';
import {
  Button,
  Checkbox,
  Input,
  RadioGroup,
  RadioGroupItem,
  StatusBadge,
} from '@biddaloy/ui/components';
import { useRegionConfig, useTranslation } from '@biddaloy/ui/i18n';
import { formatNumber } from '@biddaloy/ui/utils';
import * as React from 'react';

/** Mirrors server `HOMEWORK_MARKS_MAX` (dto/homework-submission.dto.ts). */
export const HOMEWORK_MARKS_MAX = 9999;

const STATUS_TONE = {
  NOT_SUBMITTED: 'neutral',
  SUBMITTED: 'info',
  PARTIAL: 'warning',
  DONE: 'success',
} as const;

/** What a teacher "clearing" a row goes back to (D8): uploaded work stays SUBMITTED. */
const cleared = (row: SubmissionRow) =>
  row.status === HomeworkSubmissionStatus.SUBMITTED
    ? HomeworkSubmissionStatus.SUBMITTED
    : HomeworkSubmissionStatus.NOT_SUBMITTED;

export interface SubmissionRow {
  id: string;
  student_id: string;
  student_name: string;
  roll_number?: number;
  status: HomeworkSubmissionStatus;
  marks: number | null;
}

export interface SubmissionUpdate {
  id: string;
  status?:
    | typeof HomeworkSubmissionStatus.NOT_SUBMITTED
    | typeof HomeworkSubmissionStatus.PARTIAL
    | typeof HomeworkSubmissionStatus.DONE;
  marks?: number | null;
}

export interface SubmissionSaveResult {
  id: string;
  error?: string;
}

export interface SubmissionGridProps {
  gradingMode: HomeworkGradingMode;
  rows: SubmissionRow[];
  /** Bulk-saves every dirty row; resolves with a per-row result so the
   * grid can surface which rows failed without discarding the ones that
   * succeeded. */
  onSave: (updates: SubmissionUpdate[]) => Promise<SubmissionSaveResult[]>;
  disabled?: boolean;
  /** Fires when the draft differs from `rows` (drives the close-with-unsaved prompt). */
  onDirtyChange?: (dirty: boolean) => void;
}

type Draft = Record<string, { status: HomeworkSubmissionStatus; marks: number | null }>;

function draftFromRows(rows: SubmissionRow[]): Draft {
  const draft: Draft = {};
  for (const row of rows) {
    draft[row.id] = { status: row.status, marks: row.marks };
  }
  return draft;
}

export function SubmissionGrid({
  gradingMode,
  rows,
  onSave,
  disabled = false,
  onDirtyChange,
}: SubmissionGridProps) {
  const { t } = useTranslation('homework');
  const regionConfig = useRegionConfig();
  const savingRef = React.useRef(false);
  const [draft, setDraft] = React.useState<Draft>(() => draftFromRows(rows));
  const [saving, setSaving] = React.useState(false);
  const [errors, setErrors] = React.useState<Record<string, string>>({});

  // Re-baseline the draft whenever the caller hands us a fresh `rows`
  // (e.g. after a successful save re-fetches) — mirrors `RosterMarker`'s
  // caller-owned-draft-source pattern, no internal fetch of its own.
  React.useEffect(() => {
    setDraft(draftFromRows(rows));
    setErrors({});
  }, [rows]);

  function setStatus(id: string, status: HomeworkSubmissionStatus) {
    setDraft((prev) => ({
      ...prev,
      [id]: { ...prev[id], status, marks: prev[id]?.marks ?? null },
    }));
  }

  function setMarks(row: SubmissionRow, marks: number | null) {
    setDraft((prev) => ({
      ...prev,
      [row.id]: {
        status:
          marks !== null
            ? HomeworkSubmissionStatus.DONE
            : prev[row.id]?.status === HomeworkSubmissionStatus.DONE
              ? cleared(row)
              : (prev[row.id]?.status ?? cleared(row)),
        marks,
      },
    }));
  }

  const dirty = rows.some((r) => {
    const e = draft[r.id];
    return e !== undefined && (e.status !== r.status || e.marks !== r.marks);
  });
  React.useEffect(() => onDirtyChange?.(dirty), [dirty, onDirtyChange]);

  async function handleSave() {
    if (savingRef.current) return;
    const updates: SubmissionUpdate[] = rows
      .map((row) => {
        const entry = draft[row.id];
        if (!entry) return null;
        const changed = entry.status !== row.status || entry.marks !== row.marks;
        if (!changed) return null;
        const update: SubmissionUpdate = { id: row.id };
        // SUBMITTED is student-set, never a teacher override (D9) — the toggle
        // handlers above never produce it, but `entry.status` is typed as the
        // full enum since it's seeded from `row.status` for untouched rows.
        if (entry.status !== row.status && entry.status !== HomeworkSubmissionStatus.SUBMITTED) {
          update.status = entry.status;
        }
        if (entry.marks !== row.marks) update.marks = entry.marks;
        return update;
      })
      .filter((update): update is SubmissionUpdate => update !== null);

    if (updates.length === 0) return;

    // Marks must be whole numbers 0..MAX; show the row error and send nothing otherwise.
    const markErrors: Record<string, string> = {};
    for (const update of updates) {
      const m = update.marks;
      if (m != null && (!Number.isInteger(m) || m < 0 || m > HOMEWORK_MARKS_MAX)) {
        markErrors[update.id] = t('grid.marksInvalid', {
          max: formatNumber(HOMEWORK_MARKS_MAX, regionConfig),
        });
      }
    }
    if (Object.keys(markErrors).length > 0) {
      setErrors(markErrors);
      return;
    }

    savingRef.current = true;
    setSaving(true);
    try {
      const results = await onSave(updates);
      const nextErrors: Record<string, string> = {};
      for (const result of results) {
        if (result.error) nextErrors[result.id] = result.error;
      }
      setErrors(nextErrors);
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  }

  const isDisabled = disabled || saving;

  return (
    <div className="flex flex-col gap-3">
      <ul className="flex flex-col gap-1.5">
        {rows.map((row) => {
          const entry = draft[row.id] ?? { status: row.status, marks: row.marks };
          const error = errors[row.id];
          return (
            <li key={row.id}>
              <div className="flex min-h-14 flex-wrap items-center gap-3 rounded-lg border border-border-subtle bg-card px-3 py-2">
                <span className="w-10 shrink-0 text-sm text-muted-foreground">
                  {row.roll_number ?? ''}
                </span>
                <span className="flex-1 font-medium">{row.student_name}</span>
                <StatusBadge
                  tone={STATUS_TONE[row.status]}
                  label={t(`grid.status.${row.status}`)}
                />

                {gradingMode === HomeworkGradingMode.TICK && (
                  <Checkbox
                    aria-label={t('grid.markDone', { name: row.student_name })}
                    checked={entry.status === HomeworkSubmissionStatus.DONE}
                    disabled={isDisabled}
                    onCheckedChange={(checked) =>
                      setStatus(row.id, checked ? HomeworkSubmissionStatus.DONE : cleared(row))
                    }
                  />
                )}

                {gradingMode === HomeworkGradingMode.PARTIAL && (
                  <RadioGroup
                    aria-label={t('grid.completionFor', { name: row.student_name })}
                    value={
                      entry.status === HomeworkSubmissionStatus.SUBMITTED
                        ? HomeworkSubmissionStatus.NOT_SUBMITTED
                        : entry.status
                    }
                    onValueChange={(value) =>
                      setStatus(
                        row.id,
                        value === HomeworkSubmissionStatus.NOT_SUBMITTED
                          ? cleared(row)
                          : (value as HomeworkSubmissionStatus),
                      )
                    }
                    disabled={isDisabled}
                    className="flex gap-3"
                  >
                    <label
                      htmlFor={`${row.id}-not-done`}
                      className="flex items-center gap-1 text-xs"
                    >
                      <RadioGroupItem
                        id={`${row.id}-not-done`}
                        value={HomeworkSubmissionStatus.NOT_SUBMITTED}
                      />
                      {t('grid.notDone')}
                    </label>
                    <label
                      htmlFor={`${row.id}-partial`}
                      className="flex items-center gap-1 text-xs"
                    >
                      <RadioGroupItem
                        id={`${row.id}-partial`}
                        value={HomeworkSubmissionStatus.PARTIAL}
                      />
                      {t('grid.partial')}
                    </label>
                    <label htmlFor={`${row.id}-done`} className="flex items-center gap-1 text-xs">
                      <RadioGroupItem id={`${row.id}-done`} value={HomeworkSubmissionStatus.DONE} />
                      {t('grid.done')}
                    </label>
                  </RadioGroup>
                )}

                {gradingMode === HomeworkGradingMode.MARKS && (
                  <Input
                    type="number"
                    min={0}
                    max={HOMEWORK_MARKS_MAX}
                    step={1}
                    aria-label={t('grid.marksFor', { name: row.student_name })}
                    className="w-20"
                    disabled={isDisabled}
                    value={entry.marks ?? ''}
                    onChange={(event) => {
                      const raw = event.target.value;
                      setMarks(row, raw === '' ? null : Number(raw));
                    }}
                  />
                )}
              </div>
              {error && (
                <p role="alert" className="mt-1 pl-3 text-xs text-destructive">
                  {error}
                </p>
              )}
            </li>
          );
        })}
      </ul>

      <div className="sticky bottom-0 z-10 -mx-1 border-t border-border-subtle bg-bg px-1 py-3">
        <Button
          type="button"
          onClick={() => void handleSave()}
          disabled={isDisabled || !dirty}
          loading={saving}
        >
          {t('grid.save')}
        </Button>
      </div>
    </div>
  );
}

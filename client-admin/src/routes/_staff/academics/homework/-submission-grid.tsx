/**
 * [22.4.2] One row per student against a `HomeworkAssignment`. Column set
 * depends on `Homework.grading_mode` (D11): TICK shows a single checkbox,
 * PARTIAL a 3-state radio group (D19's NOT_SUBMITTED/PARTIAL/DONE), MARKS
 * a numeric input.
 *
 * Bulk-save with per-row optimistic UI + error surfacing, following
 * `-roster-marker.tsx`'s draft pattern (local `draft` state edited row by
 * row, one bulk submit) — the closest existing "grid of per-student
 * controls + single save" precedent in this codebase (attendance has no
 * bulk-save-with-per-row-errors screen to clone instead).
 *
 * A route-partial (`-` prefix, TanStack Router convention), not a route:
 * it takes data and callbacks as props so a sibling lane (w4-g2) can wire
 * it into a real route with real hooks — this file doesn't invent an API
 * layer, per plan.
 */
import { HomeworkGradingMode, HomeworkSubmissionStatus } from '@biddaloy/shared';
import { Button, Checkbox, Input, RadioGroup, RadioGroupItem } from '@biddaloy/ui/components';
import { useTranslation } from '@biddaloy/ui/i18n';
import * as React from 'react';

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
}: SubmissionGridProps) {
  const { t } = useTranslation('homework');
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

  function setMarks(id: string, marks: number | null) {
    setDraft((prev) => ({
      ...prev,
      [id]: {
        status:
          marks !== null
            ? HomeworkSubmissionStatus.DONE
            : (prev[id]?.status ?? HomeworkSubmissionStatus.NOT_SUBMITTED),
        marks,
      },
    }));
  }

  async function handleSave() {
    const updates: SubmissionUpdate[] = rows
      .map((row) => {
        const entry = draft[row.id];
        if (!entry) return null;
        const changed = entry.status !== row.status || entry.marks !== row.marks;
        if (!changed) return null;
        const update: SubmissionUpdate = { id: row.id };
        if (entry.status !== row.status) update.status = entry.status;
        if (entry.marks !== row.marks) update.marks = entry.marks;
        return update;
      })
      .filter((update): update is SubmissionUpdate => update !== null);

    if (updates.length === 0) return;

    setSaving(true);
    try {
      const results = await onSave(updates);
      const nextErrors: Record<string, string> = {};
      for (const result of results) {
        if (result.error) nextErrors[result.id] = result.error;
      }
      setErrors(nextErrors);
    } finally {
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
                <span className="text-xs text-muted-foreground">
                  {t(`grid.status.${row.status}`)}
                </span>

                {gradingMode === HomeworkGradingMode.TICK && (
                  <Checkbox
                    aria-label={t('grid.markDone', { name: row.student_name })}
                    checked={entry.status === HomeworkSubmissionStatus.DONE}
                    disabled={isDisabled}
                    onCheckedChange={(checked) =>
                      setStatus(
                        row.id,
                        checked
                          ? HomeworkSubmissionStatus.DONE
                          : HomeworkSubmissionStatus.NOT_SUBMITTED,
                      )
                    }
                  />
                )}

                {gradingMode === HomeworkGradingMode.PARTIAL && (
                  <RadioGroup
                    aria-label={t('grid.completionFor', { name: row.student_name })}
                    value={entry.status}
                    onValueChange={(value) => setStatus(row.id, value as HomeworkSubmissionStatus)}
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
                    aria-label={t('grid.marksFor', { name: row.student_name })}
                    className="w-20"
                    disabled={isDisabled}
                    value={entry.marks ?? ''}
                    onChange={(event) => {
                      const raw = event.target.value;
                      setMarks(row.id, raw === '' ? null : Number(raw));
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

      <div>
        <Button type="button" onClick={() => void handleSave()} disabled={isDisabled}>
          {saving ? t('grid.saving') : t('grid.save')}
        </Button>
      </div>
    </div>
  );
}

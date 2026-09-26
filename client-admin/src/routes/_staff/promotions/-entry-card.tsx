/**
 * [26.7.1] Phone promotion-preview layout — the SAME feature as `$runId`'s
 * desktop grid, one student per card instead of a table, cloning
 * `marks-stepper.tsx`'s next/previous split. Commit stays available (the
 * caller route renders `CommitDialog` outside this component either way).
 */
import { Button, Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@biddaloy/ui/components';
import type { PromotionEntry } from '@biddaloy/ui/hooks';
import { useTranslation } from '@biddaloy/ui/i18n';

const NONE_VALUE = ' (none)';

const OUTCOME_KEY: Record<string, string> = {
  PROMOTE: 'outcome.promote',
  RETAIN: 'outcome.retain',
  GRADUATE: 'outcome.graduate',
};

export interface PromotionEntryCardProps {
  entries: PromotionEntry[];
  index: number;
  onIndexChange: (index: number) => void;
  groups: string[];
  readOnly: boolean;
  effective: (entry: PromotionEntry) => {
    final_outcome: string;
    group_name: string | null;
    override_note: string | null;
  };
  isOverride: (entry: PromotionEntry) => boolean;
  noteErrors: ReadonlySet<string>;
  sectionNames: Map<string, string>;
  onOutcome: (entry: PromotionEntry, outcome: 'PROMOTE' | 'RETAIN' | 'GRADUATE') => void;
  onGroup: (entry: PromotionEntry, group: string) => void;
  onNote: (studentId: string, note: string) => void;
  onNoteBlur: (entry: PromotionEntry) => void;
}

export function PromotionEntryCard({
  entries,
  index,
  onIndexChange,
  groups,
  readOnly,
  effective,
  isOverride,
  noteErrors,
  sectionNames,
  onOutcome,
  onGroup,
  onNote,
  onNoteBlur,
}: PromotionEntryCardProps) {
  const { t } = useTranslation('promotions');

  if (entries.length === 0) {
    return <p className="p-4 text-sm text-muted-foreground">{t('list.empty')}</p>;
  }

  const boundedIndex = Math.min(index, entries.length - 1);
  const entry = entries[boundedIndex]!;
  const eff = effective(entry);
  const override = isOverride(entry);
  const noteError = noteErrors.has(entry.student_id);

  return (
    <div className="flex flex-col gap-4 p-4" data-testid="promotion-entry-card">
      <div className="flex items-center justify-between">
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={boundedIndex === 0}
          onClick={() => onIndexChange(Math.max(0, boundedIndex - 1))}
        >
          {t('stepper.previous')}
        </Button>
        <span className="text-sm text-muted-foreground">
          {t('stepper.progress', { current: boundedIndex + 1, total: entries.length })}
        </span>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={boundedIndex === entries.length - 1}
          onClick={() => onIndexChange(Math.min(entries.length - 1, boundedIndex + 1))}
        >
          {t('stepper.next')}
        </Button>
      </div>

      <div className="rounded-md border p-4">
        <h2 className="text-base font-semibold">
          <span className="text-muted-foreground">{entry.student_roll_number}</span>{' '}
          {entry.student_name}
        </h2>
        <p className="text-sm text-muted-foreground">
          {t('grid.columnSuggested')}: {t(OUTCOME_KEY[entry.suggested_outcome] ?? '')}
        </p>

        <div className="mt-4 flex flex-col gap-3">
          <div className="flex flex-col gap-1">
            <span className="text-sm font-medium">{t('grid.columnFinal')}</span>
            <div className="flex items-center gap-2">
              <Button
                type="button"
                variant={eff.final_outcome === 'PROMOTE' ? 'default' : 'outline'}
                size="sm"
                disabled={readOnly}
                onClick={() => onOutcome(entry, 'PROMOTE')}
              >
                {t('outcome.promote')}
              </Button>
              <Button
                type="button"
                variant={eff.final_outcome === 'RETAIN' ? 'default' : 'outline'}
                size="sm"
                disabled={readOnly}
                onClick={() => onOutcome(entry, 'RETAIN')}
              >
                {t('outcome.retain')}
              </Button>
              <Button
                type="button"
                variant={eff.final_outcome === 'GRADUATE' ? 'default' : 'outline'}
                size="sm"
                disabled={readOnly}
                onClick={() => onOutcome(entry, 'GRADUATE')}
              >
                {t('outcome.graduate')}
              </Button>
              {override && (
                <span className="rounded bg-status-due-fg/20 px-1 text-xs text-status-due-fg">
                  {t('grid.overrideChip')}
                </span>
              )}
            </div>
          </div>

          <div className="flex flex-col gap-1">
            <span className="text-sm font-medium">{t('grid.columnGroup')}</span>
            <Select
              value={eff.group_name ?? NONE_VALUE}
              onValueChange={(value) => onGroup(entry, value)}
              disabled={readOnly}
            >
              <SelectTrigger aria-label={t('grid.columnGroup')}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NONE_VALUE}>{t('grid.groupNone')}</SelectItem>
                {groups.map((group) => (
                  <SelectItem key={group} value={group}>
                    {group}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {eff.final_outcome === 'PROMOTE' && (
            <p className="text-sm text-muted-foreground">
              {t('grid.columnTargetSection')}: {sectionNames.get(entry.target_section_id ?? '') ?? '—'}
              {' · '}
              {t('grid.columnNewRoll')}: {entry.new_roll_number ?? '—'}
            </p>
          )}

          {!override && eff.final_outcome === 'PROMOTE' && entry.placement_error && (
            <p role="alert" className="text-sm text-destructive">
              {entry.placement_error}
            </p>
          )}

          <div className="flex flex-col gap-1">
            <label htmlFor={`card-note-${entry.student_id}`} className="text-sm font-medium">
              {t('grid.columnOverrideNote')}
            </label>
            <input
              id={`card-note-${entry.student_id}`}
              type="text"
              disabled={readOnly}
              value={eff.override_note ?? ''}
              className="h-11 rounded-md border border-input bg-background px-2"
              onChange={(event) => onNote(entry.student_id, event.target.value)}
              onBlur={() => onNoteBlur(entry)}
            />
            {noteError && (
              <p role="alert" className="text-xs text-destructive">
                {t('grid.noteRequired')}
              </p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

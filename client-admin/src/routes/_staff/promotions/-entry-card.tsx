/**
 * [26.7.1] Phone promotion-preview layout — the SAME feature as `$runId`'s
 * desktop grid, one student per card instead of a table, cloning
 * `marks-stepper.tsx`'s next/previous split. Commit stays available (the
 * caller route renders `CommitDialog` outside this component either way).
 * [31.4.promotions-2] Restyled with kit controls: icon stepper, radio decision, `Input`.
 */
import {
  Button,
  Input,
  Label,
  RadioGroup,
  RadioGroupItem,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  StatusBadge,
} from '@biddaloy/ui/components';
import type { PromotionEntry } from '@biddaloy/ui/hooks';
import { useTranslation, type RegionConfig } from '@biddaloy/ui/i18n';
import { formatNumber } from '@biddaloy/ui/utils';
import { ChevronLeftIcon, ChevronRightIcon } from 'lucide-react';
import type { ReactNode } from 'react';

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
  /** The route's placement rule (section · roll, a problem badge, or a dash). */
  placement: (
    entry: PromotionEntry,
    finalOutcome: 'PROMOTE' | 'RETAIN' | 'GRADUATE',
    override: boolean,
  ) => ReactNode;
  config: RegionConfig;
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
  placement,
  config,
  onOutcome,
  onGroup,
  onNote,
  onNoteBlur,
}: PromotionEntryCardProps) {
  const { t } = useTranslation('promotions');
  const dash = t('list.emptyValue');

  if (entries.length === 0) {
    return <p className="p-4 text-text-secondary">{t('list.empty')}</p>;
  }

  const boundedIndex = Math.min(index, entries.length - 1);
  const entry = entries[boundedIndex]!;
  const eff = effective(entry);
  const override = isOverride(entry);
  const noteError = noteErrors.has(entry.student_id);
  const noteId = `card-note-${entry.student_id}`;
  const fmt = (n: number | null) => (n === null ? dash : formatNumber(n, config));

  return (
    <div
      className="space-y-4 rounded-lg border border-border-subtle bg-surface p-4 shadow-e1"
      data-testid="promotion-entry-card"
    >
      <div className="flex items-center justify-between gap-2">
        <Button
          type="button"
          variant="outline"
          className="size-11 p-0"
          aria-label={t('stepper.previous')}
          disabled={boundedIndex === 0}
          onClick={() => onIndexChange(Math.max(0, boundedIndex - 1))}
        >
          <ChevronLeftIcon aria-hidden="true" className="rtl:rotate-180" />
        </Button>
        <span className="text-text-secondary">
          {t('stepper.progress', {
            current: formatNumber(boundedIndex + 1, config),
            total: formatNumber(entries.length, config),
          })}
        </span>
        <Button
          type="button"
          variant="outline"
          className="size-11 p-0"
          aria-label={t('stepper.next')}
          disabled={boundedIndex === entries.length - 1}
          onClick={() => onIndexChange(Math.min(entries.length - 1, boundedIndex + 1))}
        >
          <ChevronRightIcon aria-hidden="true" className="rtl:rotate-180" />
        </Button>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <h2 className="text-h2">{entry.student_name ?? dash}</h2>
        {override && <StatusBadge tone="info" label={t('grid.overrideChip')} />}
      </div>

      <dl className="grid grid-cols-2 gap-x-4 gap-y-2">
        <div>
          <dt className="text-caption text-text-secondary">{t('grid.columnRoll')}</dt>
          <dd className="font-medium">{fmt(entry.student_roll_number)}</dd>
        </div>
        <div>
          <dt className="text-caption text-text-secondary">{t('grid.columnMeritRank')}</dt>
          <dd className="font-medium">{fmt(entry.merit_rank)}</dd>
        </div>
        <div>
          <dt className="text-caption text-text-secondary">{t('grid.columnMeanGpa')}</dt>
          <dd className="font-medium">
            {entry.mean_gpa === null
              ? dash
              : formatNumber(Number(entry.mean_gpa), config, { decimals: 2 })}
          </dd>
        </div>
        <div>
          <dt className="text-caption text-text-secondary">{t('grid.columnSuggested')}</dt>
          <dd className="font-medium">{t(OUTCOME_KEY[entry.suggested_outcome] ?? '')}</dd>
        </div>
        <div className="col-span-2">
          <dt className="text-caption text-text-secondary">{t('grid.columnPlacement')}</dt>
          <dd className="font-medium">
            {placement(entry, eff.final_outcome as 'PROMOTE' | 'RETAIN' | 'GRADUATE', override)}
          </dd>
        </div>
      </dl>

      <div className="space-y-1">
        <span className="font-medium">{t('grid.columnFinal')}</span>
        <RadioGroup
          aria-label={t('grid.columnFinal')}
          value={eff.final_outcome}
          onValueChange={(value) => onOutcome(entry, value as 'PROMOTE' | 'RETAIN' | 'GRADUATE')}
          disabled={readOnly}
          className="divide-y divide-border-subtle"
        >
          {(['PROMOTE', 'RETAIN', 'GRADUATE'] as const).map((outcome) => (
            <label key={outcome} className="flex min-h-11 items-center gap-3">
              <RadioGroupItem value={outcome} />
              {t(OUTCOME_KEY[outcome] ?? '')}
            </label>
          ))}
        </RadioGroup>
      </div>

      {groups.length > 0 && (
        <div className="flex flex-col gap-1.5">
          <Label htmlFor={`card-group-${entry.student_id}`}>{t('grid.columnGroup')}</Label>
          <Select
            value={eff.group_name ?? NONE_VALUE}
            onValueChange={(value) => onGroup(entry, value)}
            disabled={readOnly}
          >
            <SelectTrigger
              id={`card-group-${entry.student_id}`}
              aria-label={t('grid.columnGroup')}
              className="h-11 w-full"
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem
                value={NONE_VALUE}
                disabled={eff.group_name != null}
                title={eff.group_name != null ? t('grid.groupClearUnsupported') : undefined}
              >
                {t('grid.groupNone')}
              </SelectItem>
              {groups.map((group) => (
                <SelectItem key={group} value={group}>
                  {group}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}

      <div className="flex flex-col gap-1.5">
        <Label htmlFor={noteId}>
          {t('grid.columnOverrideNote')}
          {override && (
            <span aria-hidden="true" className="text-status-overdue-fg">
              {' '}
              *
            </span>
          )}
        </Label>
        <Input
          id={noteId}
          disabled={readOnly}
          placeholder={t('grid.notePlaceholder')}
          value={eff.override_note ?? ''}
          className="h-11"
          onChange={(event) => onNote(entry.student_id, event.target.value)}
          onBlur={() => onNoteBlur(entry)}
        />
        {noteError && (
          <p role="alert" className="text-caption text-status-overdue-fg">
            {t('grid.noteRequired')}
          </p>
        )}
      </div>
    </div>
  );
}

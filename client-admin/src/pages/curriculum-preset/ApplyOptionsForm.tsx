/** [35.4.3] Step 2: stages (>=1), versions (>=1 when the pack has any), start year. */
import { Checkbox, Input, Label } from '@biddaloy/ui/components';
import { useTranslation } from '@biddaloy/ui/i18n';

import { usePickText, type PresetSummary } from './use-presets';

export interface ApplyOptions {
  stages: string[];
  versions: string[];
  startYear: string;
}

/** The server's own rule: a pack with versions needs at least one of them. */
export function isApplyOptionsValid(summary: PresetSummary, options: ApplyOptions): boolean {
  const year = Number(options.startYear);
  return (
    options.stages.length >= 1 &&
    (!summary.versions?.length || options.versions.length >= 1) &&
    Number.isInteger(year) &&
    year >= 2000 &&
    year <= 2100
  );
}

export interface ApplyOptionsFormProps {
  summary: PresetSummary;
  value: ApplyOptions;
  onChange: (next: ApplyOptions) => void;
}

function toggle(list: string[], key: string): string[] {
  return list.includes(key) ? list.filter((k) => k !== key) : [...list, key];
}

export function ApplyOptionsForm({ summary, value, onChange }: ApplyOptionsFormProps) {
  const { t } = useTranslation('curriculumPreset');
  const pick = usePickText();

  const groups = [
    {
      id: 'stages',
      legend: t('options.stages'),
      hint: t('options.stagesHint'),
      items: summary.stages,
      field: 'stages' as const,
    },
    ...(summary.versions?.length
      ? [
          {
            id: 'versions',
            legend: t('options.versions'),
            hint: t('options.versionsHint'),
            items: summary.versions,
            field: 'versions' as const,
          },
        ]
      : []),
  ];

  return (
    <div className="flex flex-col gap-4">
      {!summary.verified && (
        <p role="note" className="rounded-lg bg-status-due-bg p-3 text-sm text-status-due-fg">
          {t('unverifiedWarning')}
        </p>
      )}
      {groups.map((group) => (
        <fieldset key={group.id} className="flex flex-col gap-2">
          <legend className="text-sm font-medium">{group.legend}</legend>
          {group.items.map((item) => {
            const id = `preset-${group.id}-${item.key}`;
            return (
              <div key={item.key} className="flex items-center gap-2">
                <Checkbox
                  id={id}
                  checked={value[group.field].includes(item.key)}
                  onCheckedChange={() =>
                    onChange({ ...value, [group.field]: toggle(value[group.field], item.key) })
                  }
                />
                <Label htmlFor={id}>{pick(item.name)}</Label>
              </div>
            );
          })}
          {value[group.field].length === 0 && (
            <p role="alert" className="text-sm text-destructive">
              {group.hint}
            </p>
          )}
        </fieldset>
      ))}
      <div className="flex flex-col gap-1">
        <Label htmlFor="preset-start-year">{t('options.startYear')}</Label>
        <Input
          id="preset-start-year"
          type="number"
          inputMode="numeric"
          className="w-32"
          aria-describedby="preset-start-year-hint"
          value={value.startYear}
          onChange={(event) => onChange({ ...value, startYear: event.target.value })}
        />
        <p id="preset-start-year-hint" className="text-sm text-muted-foreground">
          {t('options.startYearHint')}
        </p>
      </div>
    </div>
  );
}

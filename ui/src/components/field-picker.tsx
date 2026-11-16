/**
 * [71.4.01] [Epic 71 D5] Tick the form fields of an admission round from the shared catalogue:
 * grouped, searchable, with a "recommended" mark per template and a running count.
 * Controlled; every string is a prop (`countLabel` formats the count in the caller's digits).
 */
import { ADMISSION_FIELD_CATALOGUE, type AdmissionFieldDef } from '@biddaloy/shared';
import * as React from 'react';

import { Checkbox } from './checkbox';
import { Input } from './input';

export interface AdmissionFieldPickerProps {
  /** Ticked field keys. */
  value: readonly string[];
  onChange: (keys: string[]) => void;
  /** Keys the chosen template recommends. */
  recommended?: readonly string[];
  locale: 'bn' | 'en';
  /** Group key (`child`, `quota`, ...) -> heading. A missing key falls back to the key. */
  groupLabels: Record<string, string>;
  searchLabel: string;
  recommendedLabel: string;
  noMatchText: string;
  countLabel: (count: number) => string;
  fields?: readonly AdmissionFieldDef[];
}

export function AdmissionFieldPicker({
  value,
  onChange,
  recommended = [],
  locale,
  groupLabels,
  searchLabel,
  recommendedLabel,
  noMatchText,
  countLabel,
  fields = ADMISSION_FIELD_CATALOGUE,
}: AdmissionFieldPickerProps) {
  const [query, setQuery] = React.useState('');
  const ticked = new Set(value);
  const rec = new Set(recommended);
  const q = query.trim().toLowerCase();
  const shown = fields.filter(
    (f) => !q || f.label.bn.toLowerCase().includes(q) || f.label.en.toLowerCase().includes(q),
  );
  const groups = [...new Set(shown.map((f) => f.group))];

  const toggle = (key: string, on: boolean) =>
    onChange(on ? [...value, key] : value.filter((k) => k !== key));

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Input
          type="search"
          aria-label={searchLabel}
          placeholder={searchLabel}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="max-w-xs"
        />
        <p role="status" className="text-sm text-text-secondary">
          {countLabel(value.length)}
        </p>
      </div>
      {groups.length === 0 ? <p className="text-sm text-text-secondary">{noMatchText}</p> : null}
      {groups.map((g) => (
        <fieldset key={g} className="flex flex-col gap-2">
          <legend className="mb-1 text-sm font-semibold text-text-primary">
            {groupLabels[g] ?? g}
          </legend>
          {shown
            .filter((f) => f.group === g)
            .map((f) => (
              <label key={f.key} className="flex min-h-11 items-center gap-3 text-sm md:min-h-0">
                <Checkbox
                  checked={ticked.has(f.key)}
                  onCheckedChange={(c) => toggle(f.key, c === true)}
                />
                <span className="text-text-primary">{f.label[locale]}</span>
                {rec.has(f.key) ? (
                  <span className="rounded-full bg-status-partial-bg px-2 py-0.5 text-xs text-status-partial-fg">
                    {recommendedLabel}
                  </span>
                ) : null}
              </label>
            ))}
        </fieldset>
      ))}
    </div>
  );
}

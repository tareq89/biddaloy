/**
 * [8.14.8]: the one typed search form every list page uses instead of
 * hand-rolling its own `filterBar` markup. A page declares *what* it
 * filters on — a `FilterFieldDescriptor[]` — and this component owns
 * *how*: which `@biddaloy/ui` control renders each kind, the 300ms
 * debounce + Bengali-digit normalization (`use-filter-bar-state.ts`), the
 * `'__all__'` Radix-Select sentinel (every page used to redeclare this
 * itself — `client-admin/src/routes/_staff/invoices/index.tsx:36` and
 * two other pages), the mobile "Filters (n)" disclosure, and the
 * always-visible active-filter chip row — including a chip for a
 * `values` key **no descriptor covers**, which is the fix for the
 * "invisible active filter" bug class this ticket exists to kill
 * (`invoices/index.tsx` accepts `student_id` in its URL schema but never
 * rendered a control, or a chip, for it).
 *
 * Router-agnostic like every shell in this directory: takes `values` +
 * `onChange` (`ListShellState.filters` / `ListShellActions.setFilters`'s
 * own shape), never calls `useListShellState` itself — see
 * `list-shell.tsx`'s header comment for why that split exists.
 *
 * Mobile collapse is CSS-only (`md:hidden`/`md:flex` on a single control
 * tree, the same `aria-expanded`/`aria-controls` grammar
 * `app-shell.tsx`'s nav-group disclosure already uses) — no `matchMedia`
 * hook, no second copy of the controls, since two trees would mean
 * duplicate ids and duplicate form controls, which axe (rightly) flags.
 * The chip row is *never* part of that collapsible tree — an active
 * filter must stay visible and clearable on a 320px phone even while the
 * controls that created it are collapsed behind the trigger.
 */
import * as React from 'react';

import { Button } from '../components/button';
import { Checkbox } from '../components/checkbox';
import { DatePicker } from '../components/date-picker';
import { Input } from '../components/input';
import { Label } from '../components/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../components/select';
import { useRegionConfig, useTranslation } from '../i18n';
import { cn } from '../primitives/lib/utils';
import { formatDate, parseDate, toLatinDigits } from '../utils';

import { useFilterBarState } from './use-filter-bar-state';

/** Radix `Select.Item` rejects an empty-string `value` — this is the one
 * place that sentinel is declared; no caller needs its own anymore. */
const ALL_VALUE = '__all__';

export interface FilterOption {
  value: string;
  label: string;
}

export interface TextFilterField {
  kind: 'text';
  key: string;
  label: string;
  placeholder?: string;
  /** Stays inline, always visible, even on a collapsed mobile bar — the
   * issue's own "primary text search stays inline" requirement. At most
   * one field should set this; a second one is a dev-mode warning, not a
   * type error (a tuple/union big enough to enforce "at most one" isn't
   * worth the API complexity for a mistake `console.warn` already flags
   * loudly in development). */
  primary?: boolean;
}

export interface SelectFilterField {
  kind: 'select';
  key: string;
  label: string;
  /** Label for the built-in "no filter" option — caller-supplied so it
   * stays in the page's own i18n namespace (e.g. "All statuses"),
   * matching every hand-rolled `filterBar` this replaces. */
  allLabel: string;
  options: readonly FilterOption[];
}

export interface DateRangeFilterField {
  kind: 'date-range';
  /** Explicit URL keys, not derived from a single `key` — live Zod search
   * schemas already use `from_date`/`to_date`, which no `${key}_from`
   * derivation rule would produce; this keeps the URL schema, not the
   * descriptor, as the source of truth for param names. */
  fromKey: string;
  toKey: string;
  label: string;
  fromLabel: string;
  toLabel: string;
}

export interface CheckboxFilterField {
  kind: 'checkbox';
  key: string;
  label: string;
}

export interface NumberRangeFilterField {
  kind: 'number-range';
  minKey: string;
  maxKey: string;
  label: string;
  minLabel: string;
  maxLabel: string;
}

export type FilterFieldDescriptor =
  | TextFilterField
  | SelectFilterField
  | DateRangeFilterField
  | CheckboxFilterField
  | NumberRangeFilterField;

export interface FilterBarProps {
  fields: readonly FilterFieldDescriptor[];
  /** `ListShellState.filters`. */
  values: Record<string, string>;
  /** `ListShellActions.setFilters`. */
  onChange: (patch: Record<string, string | null>) => void;
  /** @default 300 */
  debounceMs?: number;
}

/** `parseDate` throws on anything that isn't a real `YYYY-MM-DD` date — a
 * hand-edited or stale URL param must not crash the whole bar, just show
 * the date field as empty. */
function safeParseDate(raw: string | undefined): Date | undefined {
  if (!raw) return undefined;
  try {
    return parseDate(raw);
  } catch {
    return undefined;
  }
}

/** Every `values` key a descriptor renders a control for — used to count
 * only the filters actually hidden behind the mobile disclosure. A
 * `primary` text field stays inline (never collapsed) and a deep-linked
 * key with no matching descriptor gets a chip but no control at all, so
 * neither should count toward "Filters (n)" — that count is a promise
 * about what opening the panel reveals, not the total active-filter
 * count (the chip row already shows that in full, uncollapsed). */
function keysOf(field: FilterFieldDescriptor): string[] {
  switch (field.kind) {
    case 'text':
    case 'select':
    case 'checkbox':
      return [field.key];
    case 'date-range':
      return [field.fromKey, field.toKey];
    case 'number-range':
      return [field.minKey, field.maxKey];
  }
}

export function FilterBar({ fields, values, onChange, debounceMs }: FilterBarProps) {
  const { t } = useTranslation();
  const regionConfig = useRegionConfig();
  const panelId = React.useId();
  const [expanded, setExpanded] = React.useState(false);

  // `exactOptionalPropertyTypes` is on for this package, so `debounceMs`
  // (optional on both `FilterBarProps` and `UseFilterBarStateOptions`)
  // can't be forwarded as `number | undefined` even though both sides
  // declare it optional — only an omitted key satisfies "optional",
  // an explicit `undefined` value does not. Spread it in only when set.
  const { localValues, setLocalValue, setValue, chips, clearFilter, clearAll } = useFilterBarState({
    fields,
    values,
    onChange,
    ...(debounceMs !== undefined ? { debounceMs } : {}),
  });

  const primaryFields = fields.filter(
    (field): field is TextFilterField => field.kind === 'text' && field.primary === true,
  );
  if (process.env.NODE_ENV !== 'production' && primaryFields.length > 1) {
    console.warn(
      '[FilterBar] more than one field has `primary: true` — only the first stays inline on ' +
        'mobile; the rest fall behind the "Filters (n)" disclosure like any other field.',
    );
  }
  const primaryField = primaryFields[0];
  const collapsibleFields = fields.filter((field) => field !== primaryField);

  // "Filters (n)" is a promise about what opening the panel reveals, not
  // the total active-filter count — a `primary` field's own chip (stays
  // inline, never collapsed) and a deep-linked unknown-key chip (no
  // control at all, so nothing to reveal) must not inflate it.
  const collapsibleKeys = new Set(collapsibleFields.flatMap(keysOf));
  const collapsibleActiveCount = chips.filter((chip) => collapsibleKeys.has(chip.key)).length;

  function renderField(field: FilterFieldDescriptor) {
    switch (field.kind) {
      case 'text':
        return (
          <Input
            key={field.key}
            aria-label={field.label}
            placeholder={field.placeholder}
            className={cn(field.primary ? 'min-w-40 flex-1' : 'w-40')}
            value={localValues[field.key] ?? ''}
            onChange={(event) => setLocalValue(field.key, event.target.value)}
          />
        );
      case 'select': {
        const current = values[field.key];
        // A URL/deep-link value that isn't one of `field.options` (a status
        // since renamed, a stale bookmark) must not render the trigger
        // blank — that's the same "invisible active filter" bug class this
        // ticket exists to kill, just one descriptor level down from the
        // no-descriptor-at-all case the chip row already covers. Inject a
        // synthetic item so the trigger still shows *something* and the
        // value stays selectable back to itself / clearable via "All".
        const isKnown =
          current === undefined || field.options.some((option) => option.value === current);
        return (
          <Select
            key={field.key}
            value={current ?? ALL_VALUE}
            onValueChange={(value) => setValue(field.key, value === ALL_VALUE ? null : value)}
          >
            <SelectTrigger aria-label={field.label} className="w-40">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL_VALUE}>{field.allLabel}</SelectItem>
              {!isKnown && current !== undefined && (
                <SelectItem value={current}>
                  {t('filters.unknownFilter', { key: field.label, value: current })}
                </SelectItem>
              )}
              {field.options.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        );
      }
      case 'date-range':
        return (
          <div
            key={`${field.fromKey}:${field.toKey}`}
            role="group"
            aria-label={field.label}
            className="flex items-center gap-1.5"
          >
            <DatePicker
              aria-label={field.fromLabel}
              config={regionConfig}
              value={safeParseDate(values[field.fromKey])}
              onValueChange={(date) =>
                setValue(field.fromKey, date ? toLatinDigits(formatDate(date, regionConfig)) : null)
              }
            />
            <span aria-hidden="true" className="text-muted-foreground">
              –
            </span>
            <DatePicker
              aria-label={field.toLabel}
              config={regionConfig}
              value={safeParseDate(values[field.toKey])}
              onValueChange={(date) =>
                setValue(field.toKey, date ? toLatinDigits(formatDate(date, regionConfig)) : null)
              }
            />
          </div>
        );
      case 'checkbox':
        return (
          <div key={field.key} className="flex items-center gap-2">
            <Checkbox
              id={`filter-bar-${field.key}`}
              checked={values[field.key] === 'true'}
              onCheckedChange={(checked) => setValue(field.key, checked === true ? 'true' : null)}
            />
            <Label htmlFor={`filter-bar-${field.key}`}>{field.label}</Label>
          </div>
        );
      case 'number-range':
        return (
          <div
            key={`${field.minKey}:${field.maxKey}`}
            role="group"
            aria-label={field.label}
            className="flex items-center gap-1.5"
          >
            <Input
              aria-label={field.minLabel}
              type="text"
              inputMode="numeric"
              className="w-20"
              value={localValues[field.minKey] ?? ''}
              onChange={(event) => setLocalValue(field.minKey, event.target.value)}
            />
            <span aria-hidden="true" className="text-muted-foreground">
              –
            </span>
            <Input
              aria-label={field.maxLabel}
              type="text"
              inputMode="numeric"
              className="w-20"
              value={localValues[field.maxKey] ?? ''}
              onChange={(event) => setLocalValue(field.maxKey, event.target.value)}
            />
          </div>
        );
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        {primaryField && renderField(primaryField)}
        {collapsibleFields.length > 0 && (
          <Button
            type="button"
            variant="outline"
            className="md:hidden"
            aria-expanded={expanded}
            aria-controls={panelId}
            onClick={() => setExpanded((value) => !value)}
          >
            {expanded
              ? t('filters.hideFilters')
              : collapsibleActiveCount === 0
                ? t('filters.showFiltersNone')
                : t('filters.showFilters', { count: collapsibleActiveCount })}
          </Button>
        )}
      </div>
      {collapsibleFields.length > 0 && (
        <div
          id={panelId}
          className={cn(
            'flex flex-wrap items-center gap-2',
            expanded ? 'flex' : 'hidden',
            'md:flex',
          )}
        >
          {collapsibleFields.map(renderField)}
        </div>
      )}
      {chips.length > 0 && (
        <ul aria-label={t('filters.activeFilters')} className="flex flex-wrap items-center gap-2">
          {chips.map((chip) => {
            const label =
              chip.label ?? t('filters.unknownFilter', { key: chip.key, value: chip.value });
            return (
              <li
                key={chip.key}
                className="flex items-center gap-1 rounded-full border border-border-subtle bg-muted px-2 py-1 text-xs text-muted-foreground"
              >
                <span>{label}</span>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  iconOnly
                  aria-label={t('filters.removeFilter', { label })}
                  onClick={() => clearFilter(chip.key)}
                >
                  <span aria-hidden="true">×</span>
                </Button>
              </li>
            );
          })}
          {chips.length > 1 && (
            <li>
              <Button type="button" variant="ghost" size="sm" onClick={clearAll}>
                {t('filters.clearAll')}
              </Button>
            </li>
          )}
        </ul>
      )}
    </div>
  );
}

/**
 * Generic "add/remove/reorder a list of rows, save the whole list" form.
 * Client half of the pattern whose server half is 23.3's
 * `repeatable-row.base.service.ts` — `onSave` is called with the full
 * replacement array, matching that service's `replaceRows` shape.
 *
 * Config-driven by field schema so it has zero staff-specific knowledge:
 * callers describe what a row looks like (`fields`), this component owns
 * the add/remove/reorder chrome and the empty state.
 *
 * Reorder is plain up/down buttons, not drag-and-drop — nothing in the
 * ticket asks for drag-and-drop, and up/down is the smaller diff.
 */
import * as React from 'react';

import { Button } from '../button';
import { Checkbox } from '../checkbox';
import { EmptyState } from '../empty-state';
import { Input } from '../input';
import { Label } from '../label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../select';

export type RepeatableRowFieldType = 'text' | 'number' | 'checkbox' | 'select';

export interface RepeatableRowField {
  key: string;
  label: string;
  type: RepeatableRowFieldType;
  required?: boolean;
  /** Options for `type: 'select'`. Ignored by every other type. */
  options?: { value: string; label: string }[];
}

export type RepeatableRowValue = Record<string, string | number | boolean>;

/**
 * `T` is left as `extends object` rather than `extends RepeatableRowValue` —
 * every caller's row type is a plain interface (e.g. `AchievementRow`), and
 * TS's structural check for "does this interface satisfy a type with an
 * index signature" fails even when every property matches, so requiring the
 * stricter constraint would force a cast at every call site instead of once,
 * here.
 */
export interface RepeatableRowFormProps<T extends object = RepeatableRowValue> {
  /** Describes each column of a row: label, type, whether it's required. */
  fields: RepeatableRowField[];
  rows: T[];
  /** Called with the full replacement array — never a single row's diff. */
  onSave: (rows: T[]) => void;
  /** Heading shown above the form and reused as the empty state's title. */
  title?: string;
  /** Empty-state copy. Defaults to a generic "not filled in yet" message. */
  emptyExplanation?: string;
  addRowLabel?: string;
  saveLabel?: string;
}

function emptyRow<T extends object>(fields: RepeatableRowField[]): T {
  const row: RepeatableRowValue = {};
  for (const field of fields) {
    row[field.key] = field.type === 'checkbox' ? false : '';
  }
  return row as T;
}

export function RepeatableRowForm<T extends object = RepeatableRowValue>({
  fields,
  rows,
  onSave,
  title,
  emptyExplanation = 'Not filled in yet.',
  addRowLabel = 'Add row',
  saveLabel = 'Save',
}: RepeatableRowFormProps<T>) {
  const [draftRows, setDraftRows] = React.useState<T[]>(rows);

  React.useEffect(() => {
    setDraftRows(rows);
  }, [rows]);

  const addRow = () => setDraftRows((prev) => [...prev, emptyRow<T>(fields)]);

  const removeRow = (index: number) => setDraftRows((prev) => prev.filter((_, i) => i !== index));

  const moveRow = (index: number, direction: -1 | 1) => {
    setDraftRows((prev) => {
      const target = index + direction;
      if (target < 0 || target >= prev.length) return prev;
      const next = [...prev];
      const current = next[index];
      const swapped = next[target];
      if (!current || !swapped) return prev;
      next[index] = swapped;
      next[target] = current;
      return next;
    });
  };

  const updateField = (index: number, key: string, value: string | number | boolean) => {
    setDraftRows((prev) =>
      prev.map((row, i) => (i === index ? { ...row, [key]: value } : row)),
    );
  };

  if (draftRows.length === 0) {
    return (
      <EmptyState
        title={title ?? 'No rows yet'}
        explanation={emptyExplanation}
        action={{ label: addRowLabel, onClick: addRow }}
      />
    );
  }

  return (
    <div data-slot="repeatable-row-form" className="flex flex-col gap-4">
      {title && <h2 className="font-medium">{title}</h2>}
      <div className="flex flex-col gap-3">
        {draftRows.map((row, index) => (
          <div
            key={index}
            data-testid="repeatable-row"
            className="flex flex-wrap items-end gap-3 rounded-lg border border-border-subtle p-3"
          >
            {fields.map((field) => {
              const fieldId = `row-${index}-${field.key}`;
              return (
                <div key={field.key} className="flex flex-col gap-1">
                  <Label htmlFor={fieldId}>
                    {field.label}
                    {field.required && ' *'}
                  </Label>
                  {field.type === 'checkbox' ? (
                    <Checkbox
                      id={fieldId}
                      checked={Boolean((row as RepeatableRowValue)[field.key])}
                      onCheckedChange={(checked) => updateField(index, field.key, checked === true)}
                    />
                  ) : field.type === 'select' ? (
                    <Select
                      value={String((row as RepeatableRowValue)[field.key] ?? '')}
                      onValueChange={(value) => updateField(index, field.key, value)}
                    >
                      <SelectTrigger id={fieldId} aria-label={field.label}>
                        <SelectValue placeholder={field.label} />
                      </SelectTrigger>
                      <SelectContent>
                        {(field.options ?? []).map((option) => (
                          <SelectItem key={option.value} value={option.value}>
                            {option.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  ) : (
                    <Input
                      id={fieldId}
                      type={field.type === 'number' ? 'number' : 'text'}
                      required={field.required}
                      value={(row as RepeatableRowValue)[field.key] as string | number}
                      onChange={(event) =>
                        updateField(
                          index,
                          field.key,
                          field.type === 'number'
                            ? Number.isNaN(event.target.valueAsNumber)
                              ? ''
                              : event.target.valueAsNumber
                            : event.target.value,
                        )
                      }
                    />
                  )}
                </div>
              );
            })}
            <div className="ms-auto flex items-center gap-1">
              <Button
                type="button"
                variant="ghost"
                iconOnly
                aria-label="Move row up"
                disabled={index === 0}
                onClick={() => moveRow(index, -1)}
              >
                ↑
              </Button>
              <Button
                type="button"
                variant="ghost"
                iconOnly
                aria-label="Move row down"
                disabled={index === draftRows.length - 1}
                onClick={() => moveRow(index, 1)}
              >
                ↓
              </Button>
              <Button
                type="button"
                variant="ghost"
                iconOnly
                aria-label="Remove row"
                onClick={() => removeRow(index)}
              >
                ×
              </Button>
            </div>
          </div>
        ))}
      </div>
      <div className="flex items-center gap-2">
        <Button type="button" variant="outline" onClick={addRow}>
          {addRowLabel}
        </Button>
        <Button type="button" onClick={() => onSave(draftRows)}>
          {saveLabel}
        </Button>
      </div>
    </div>
  );
}

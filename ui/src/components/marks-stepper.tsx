/**
 * [19.7.1] Phone marks-entry layout — D7/D13 step 6: the SAME feature as
 * `marks-grid.tsx`, one student per card instead of a table. Same `A`/`E`
 * semantics, same over-max-at-the-cell refusal, same `onStage` contract
 * so both layouts can share one `autosave.ts` instance — this component
 * never talks to the network either.
 */
import { ChevronLeftIcon, ChevronRightIcon, CircleCheckIcon } from 'lucide-react';
import * as React from 'react';

import { useTranslation } from '../i18n';
import { useRegionConfig } from '../i18n/region-config-provider';
import { cn } from '../primitives/lib/utils';
import { renderDigits, toLatinDigits } from '../utils/digits';

import { Button } from './button';
import { EmptyState } from './empty-state';
import {
  cellKey,
  formatDerived,
  formatMax,
  toStagedMark,
  type MarksGridCell,
  type MarksGridCellValue,
  type MarksGridComponent,
  type MarksGridStudent,
} from './marks-grid';

export interface MarksStepperProps {
  students: MarksGridStudent[];
  components: MarksGridComponent[];
  cells: MarksGridCell[];
  derived?: Record<string, { values: Record<string, string | null> }>;
  readOnly?: boolean;
  onStage: (key: string, cell: MarksGridCell) => void;
  pendingKeys?: ReadonlySet<string>;
  failedKeys?: ReadonlySet<string>;
}

function seedValues(cells: MarksGridCell[]): Map<string, MarksGridCellValue> {
  const map = new Map<string, MarksGridCellValue>();
  for (const cell of cells) {
    map.set(cellKey(cell.student_id, cell.component_id), {
      value: cell.value,
      status: cell.status,
    });
  }
  return map;
}

export function MarksStepper({
  students,
  components,
  cells,
  derived = {},
  readOnly = false,
  onStage,
  pendingKeys = new Set(),
  failedKeys = new Set(),
}: MarksStepperProps) {
  const { t } = useTranslation('exams');
  const config = useRegionConfig();
  const editableComponents = components.filter((c) => c.source !== 'DERIVED');
  const derivedComponents = components.filter((c) => c.source === 'DERIVED');

  const [index, setIndex] = React.useState(0);
  const [values, setValues] = React.useState<Map<string, MarksGridCellValue>>(() =>
    seedValues(cells),
  );
  const [cellErrors, setCellErrors] = React.useState<Map<string, string>>(new Map());
  const seededCellsRef = React.useRef(cells);
  if (seededCellsRef.current !== cells) {
    seededCellsRef.current = cells;
    setValues(seedValues(cells));
  }

  if (students.length === 0) {
    return (
      <EmptyState
        title={t('marksEntry.emptyTitle', { ns: 'common' })}
        explanation={t('marksGrid.empty')}
      />
    );
  }

  const boundedIndex = Math.min(index, students.length - 1);
  const student = students[boundedIndex]!;

  function commit(
    componentId: string,
    next: MarksGridCellValue,
    staged: MarksGridCellValue = next,
  ) {
    const key = cellKey(student.id, componentId);
    setValues((prev) => new Map(prev).set(key, next));
    onStage(key, { student_id: student.id, component_id: componentId, ...staged });
  }

  function handleValueInput(component: MarksGridComponent, raw: string) {
    const key = cellKey(student.id, component.id);
    if (raw === '') {
      setCellErrors((prev) => {
        if (!prev.has(key)) return prev;
        const copy = new Map(prev);
        copy.delete(key);
        return copy;
      });
      commit(component.id, { value: null, status: 'PRESENT' });
      return;
    }
    if (!/^\d*\.?\d*$/.test(raw)) return;
    const numeric = Number(raw);
    if (!Number.isNaN(numeric) && numeric > Number(component.full_marks)) {
      setCellErrors((prev) =>
        new Map(prev).set(key, t('marksGrid.cellMax', { max: formatMax(component, config) })),
      );
      return;
    }
    setCellErrors((prev) => {
      if (!prev.has(key)) return prev;
      const copy = new Map(prev);
      copy.delete(key);
      return copy;
    });
    commit(
      component.id,
      { value: raw, status: 'PRESENT' },
      { value: toStagedMark(raw), status: 'PRESENT' },
    );
  }

  const rowSaved = editableComponents.every((component) => {
    const key = cellKey(student.id, component.id);
    return !pendingKeys.has(key) && !failedKeys.has(key);
  });

  return (
    <div className="flex flex-col gap-4 p-4" data-testid="marks-stepper">
      <div className="flex items-center justify-between">
        <Button
          type="button"
          variant="outline"
          disabled={boundedIndex === 0}
          onClick={() => setIndex((i) => Math.max(0, i - 1))}
        >
          <ChevronLeftIcon className="rtl:rotate-180" aria-hidden="true" />
          {t('marksStepper.previous')}
        </Button>
        <span className="text-body text-text-secondary">
          {t('marksStepper.progress', { current: boundedIndex + 1, total: students.length })}
        </span>
        <Button
          type="button"
          variant="outline"
          disabled={boundedIndex === students.length - 1}
          onClick={() => setIndex((i) => Math.min(students.length - 1, i + 1))}
        >
          {t('marksStepper.next')}
          <ChevronRightIcon className="rtl:rotate-180" aria-hidden="true" />
        </Button>
      </div>

      <div className="rounded-lg border border-border-subtle bg-surface p-4">
        <h2 className="flex items-center gap-2 text-h3">
          <span className="text-text-secondary">
            {renderDigits(String(student.roll_number), config.numerals)}
          </span>
          {student.full_name}
          {rowSaved && (
            <CircleCheckIcon
              className="size-4 text-status-paid-fg"
              aria-label={t('marksGrid.rowSaved')}
            />
          )}
        </h2>

        <div className="mt-4 flex flex-col gap-3">
          {editableComponents.map((component) => {
            const key = cellKey(student.id, component.id);
            const cellValue = values.get(key) ?? { value: null, status: 'PRESENT' as const };
            const error = cellErrors.get(key);
            const isFailed = failedKeys.has(key);
            const isPending = pendingKeys.has(key) && !isFailed;
            const displayValue =
              cellValue.status === 'ABSENT'
                ? t('marksGrid.absentShort')
                : cellValue.status === 'EXEMPT'
                  ? t('marksGrid.exemptShort')
                  : renderDigits(cellValue.value ?? '', config.numerals);
            return (
              <div key={component.id} className="flex flex-col gap-1">
                <label htmlFor={`stepper-${key}`} className="text-label text-text-primary">
                  {component.name}{' '}
                  <span className="text-text-secondary">
                    {t('marksGrid.fullMarks', { max: formatMax(component, config) })}
                  </span>
                </label>
                <div className="flex items-center gap-2">
                  <input
                    id={`stepper-${key}`}
                    type="text"
                    inputMode="decimal"
                    disabled={readOnly}
                    value={displayValue}
                    className={cn(
                      'h-11 w-24 rounded-md border border-border-functional bg-surface px-2 text-end text-body text-text-primary tabular-nums md:h-8',
                      isFailed && 'border-destructive',
                      isPending && 'border-status-due-fg',
                    )}
                    onChange={(event) =>
                      handleValueInput(component, toLatinDigits(event.target.value))
                    }
                    onKeyDown={(event) => {
                      if (event.key === 'a' || event.key === 'A') {
                        event.preventDefault();
                        commit(component.id, { value: null, status: 'ABSENT' });
                      } else if (event.key === 'e' || event.key === 'E') {
                        event.preventDefault();
                        commit(component.id, { value: null, status: 'EXEMPT' });
                      }
                    }}
                  />
                  <Button
                    type="button"
                    variant="outline"
                    disabled={readOnly}
                    onClick={() => commit(component.id, { value: null, status: 'ABSENT' })}
                  >
                    {t('marksEntry.absent', { ns: 'common' })}
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    disabled={readOnly}
                    onClick={() => commit(component.id, { value: null, status: 'EXEMPT' })}
                  >
                    {t('marksEntry.exempt', { ns: 'common' })}
                  </Button>
                </div>
                {error && <p className="text-caption text-destructive">{error}</p>}
              </div>
            );
          })}

          {derivedComponents.map((component) => (
            <div key={component.id} className="flex flex-col gap-1 rounded-md bg-muted p-2">
              <span className="text-label text-text-secondary">{component.name}</span>
              <span className="text-body">
                {formatDerived(derived[component.id]?.values[student.id], config)}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

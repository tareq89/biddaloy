/**
 * [19.7.1] Desktop marks-entry grid — D7/D11/D13. Rows = students (sticky
 * roll+name column), columns = components, one derived (read-only,
 * visually distinct) column per D11. Purely a controlled display + local
 * edit buffer: it owns the in-progress cell values a teacher is typing,
 * but every committed edit is handed to the caller's `onStage` (normally
 * `autosave.ts`'s `stage`) rather than persisted here — this component
 * never talks to the network.
 *
 * Keyboard model (D7): `Enter` moves down the SAME column (not reading
 * order), `Tab` relies on the browser's native row-major tab order across
 * the grid's real `<input>` elements, arrow keys navigate freely, `A`/`E`
 * set ABSENT/EXEMPT without needing a numeric value.
 */
import * as React from 'react';

import { useTranslation } from '../i18n';
import { cn } from '../primitives/lib/utils';

export type MarksGridStatus = 'PRESENT' | 'ABSENT' | 'EXEMPT';

export interface MarksGridStudent {
  id: string;
  roll_number: number;
  full_name: string;
}

export interface MarksGridComponent {
  id: string;
  name: string;
  source: 'MANUAL' | 'DERIVED';
  full_marks: string;
}

export interface MarksGridCellValue {
  value: string | null;
  status: MarksGridStatus;
}

export interface MarksGridCell extends MarksGridCellValue {
  student_id: string;
  component_id: string;
}

export function cellKey(studentId: string, componentId: string): string {
  return `${studentId}:${componentId}`;
}

/** The cell input allows a number-in-progress ("5.", "."), but the server's
 * `@IsNumberString` rejects both — one such cell would fail its whole
 * autosave batch on every retry. Stage what the text means instead:
 * "5." → "5", "." → blank. The cell itself keeps showing what was typed. */
export function toStagedMark(raw: string): string | null {
  const complete = raw.endsWith('.') ? raw.slice(0, -1) : raw;
  return complete === '' ? null : complete;
}

export interface MarksGridProps {
  students: MarksGridStudent[];
  components: MarksGridComponent[];
  /** Seed values — usually the server's current `cells`. */
  cells: MarksGridCell[];
  /** Derived (attendance) component values, pre-computed server-side. */
  derived?: Record<string, { values: Record<string, string | null> }>;
  readOnly?: boolean;
  /** Called on every committed edit — the caller wires this to
   * `autosave.ts`'s `stage`. */
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

export function MarksGrid({
  students,
  components,
  cells,
  derived = {},
  readOnly = false,
  onStage,
  pendingKeys = new Set(),
  failedKeys = new Set(),
}: MarksGridProps) {
  const { t } = useTranslation('exams');
  const editableComponents = components.filter((c) => c.source !== 'DERIVED');
  const derivedComponents = components.filter((c) => c.source === 'DERIVED');
  const orderedComponents = [...editableComponents, ...derivedComponents];

  // Seeded once per distinct `cells` identity — after that, this grid owns
  // the buffer (parent doesn't re-push cells mid-edit-session).
  const [values, setValues] = React.useState<Map<string, MarksGridCellValue>>(() =>
    seedValues(cells),
  );
  const [cellErrors, setCellErrors] = React.useState<Map<string, string>>(new Map());
  const seededCellsRef = React.useRef(cells);
  if (seededCellsRef.current !== cells) {
    seededCellsRef.current = cells;
    // Re-seed only when the caller hands in a genuinely new `cells`
    // reference (e.g. switching to a different grid) — see module doc.
    setValues(seedValues(cells));
  }

  const inputRefs = React.useRef(new Map<string, HTMLInputElement>());

  function refKey(rowIndex: number, colIndex: number): string {
    return `${rowIndex}:${colIndex}`;
  }

  function focusCell(rowIndex: number, colIndex: number) {
    const row = Math.max(0, Math.min(students.length - 1, rowIndex));
    const col = Math.max(0, Math.min(editableComponents.length - 1, colIndex));
    inputRefs.current.get(refKey(row, col))?.focus();
  }

  function commit(
    studentId: string,
    componentId: string,
    next: MarksGridCellValue,
    staged: MarksGridCellValue = next,
  ) {
    const key = cellKey(studentId, componentId);
    setValues((prev) => {
      const copy = new Map(prev);
      copy.set(key, next);
      return copy;
    });
    onStage(key, { student_id: studentId, component_id: componentId, ...staged });
  }

  function handleValueInput(
    studentId: string,
    component: MarksGridComponent,
    raw: string,
    rowIndex: number,
    colIndex: number,
  ) {
    const key = cellKey(studentId, component.id);
    if (raw === '') {
      setCellErrors((prev) => {
        if (!prev.has(key)) return prev;
        const copy = new Map(prev);
        copy.delete(key);
        return copy;
      });
      commit(studentId, component.id, { value: null, status: 'PRESENT' });
      return;
    }
    if (!/^\d*\.?\d*$/.test(raw)) return; // not a number-in-progress — ignore the keystroke
    const numeric = Number(raw);
    if (!Number.isNaN(numeric) && numeric > Number(component.full_marks)) {
      setCellErrors((prev) =>
        new Map(prev).set(key, t('marksGrid.cellMax', { max: component.full_marks })),
      );
      return; // refused at the cell — never collected as a submit-time error
    }
    setCellErrors((prev) => {
      if (!prev.has(key)) return prev;
      const copy = new Map(prev);
      copy.delete(key);
      return copy;
    });
    commit(
      studentId,
      component.id,
      { value: raw, status: 'PRESENT' },
      { value: toStagedMark(raw), status: 'PRESENT' },
    );
    void rowIndex;
    void colIndex;
  }

  function handleKeyDown(
    event: React.KeyboardEvent<HTMLInputElement>,
    studentId: string,
    component: MarksGridComponent,
    rowIndex: number,
    colIndex: number,
  ) {
    const key = event.key;
    if (key === 'a' || key === 'A') {
      event.preventDefault();
      commit(studentId, component.id, { value: null, status: 'ABSENT' });
      return;
    }
    if (key === 'e' || key === 'E') {
      event.preventDefault();
      commit(studentId, component.id, { value: null, status: 'EXEMPT' });
      return;
    }
    if (key === 'Enter') {
      event.preventDefault();
      focusCell(rowIndex + 1, colIndex);
      return;
    }
    if (key === 'ArrowDown') {
      event.preventDefault();
      focusCell(rowIndex + 1, colIndex);
      return;
    }
    if (key === 'ArrowUp') {
      event.preventDefault();
      focusCell(rowIndex - 1, colIndex);
      return;
    }
    if (key === 'ArrowLeft') {
      event.preventDefault();
      focusCell(rowIndex, colIndex - 1);
      return;
    }
    if (key === 'ArrowRight') {
      event.preventDefault();
      focusCell(rowIndex, colIndex + 1);
    }
  }

  if (students.length === 0) {
    return <p className="p-4 text-sm text-muted-foreground">{t('marksGrid.empty')}</p>;
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-sm">
        <caption className="sr-only">{t('marksGrid.caption')}</caption>
        <thead>
          <tr className="border-b text-start text-muted-foreground">
            <th className="sticky start-0 z-10 min-w-40 bg-background px-2 py-2">
              {t('marksGrid.columnStudent')}
            </th>
            {orderedComponents.map((component) => (
              <th
                key={component.id}
                scope="col"
                className={cn(
                  'min-w-24 px-2 py-2',
                  component.source === 'DERIVED' && 'bg-muted text-muted-foreground',
                )}
              >
                {component.name}
                <span className="block text-xs font-normal">
                  {t('marksGrid.fullMarks', { max: component.full_marks })}
                </span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {students.map((student, rowIndex) => {
            const rowSaved = editableComponents.every((component) => {
              const key = cellKey(student.id, component.id);
              return !pendingKeys.has(key) && !failedKeys.has(key);
            });
            return (
              <tr key={student.id} className="border-b">
                <td className="sticky start-0 z-10 bg-background px-2 py-2">
                  <span className="font-medium">{student.roll_number}</span> {student.full_name}
                  {rowSaved && (
                    <span
                      aria-label={t('marksGrid.rowSaved')}
                      className="ms-1 text-status-paid-fg"
                      data-testid={`row-saved-${student.id}`}
                    >
                      ✓
                    </span>
                  )}
                </td>
                {editableComponents.map((component, colIndex) => {
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
                        : (cellValue.value ?? '');
                  return (
                    <td key={component.id} className="px-2 py-1 align-top">
                      <input
                        ref={(el) => {
                          if (el) inputRefs.current.set(refKey(rowIndex, colIndex), el);
                          else inputRefs.current.delete(refKey(rowIndex, colIndex));
                        }}
                        type="text"
                        inputMode="decimal"
                        disabled={readOnly}
                        aria-label={t('marksGrid.cellLabel', {
                          name: student.full_name,
                          component: component.name,
                        })}
                        value={displayValue}
                        className={cn(
                          'h-9 w-20 rounded-md border border-input bg-background px-2 text-end',
                          isFailed && 'border-destructive',
                          isPending && 'border-status-due-fg',
                        )}
                        onChange={(event) => {
                          if (cellValue.status !== 'PRESENT') {
                            // Typing over ABSENT/EXEMPT restores PRESENT semantics.
                            handleValueInput(
                              student.id,
                              component,
                              event.target.value.replace(/[^\d.]/g, ''),
                              rowIndex,
                              colIndex,
                            );
                            return;
                          }
                          handleValueInput(
                            student.id,
                            component,
                            event.target.value,
                            rowIndex,
                            colIndex,
                          );
                        }}
                        onKeyDown={(event) =>
                          handleKeyDown(event, student.id, component, rowIndex, colIndex)
                        }
                      />
                      {error && <p className="text-xs text-destructive">{error}</p>}
                    </td>
                  );
                })}
                {derivedComponents.map((component) => (
                  <td
                    key={component.id}
                    className="bg-muted px-2 py-1 text-end text-muted-foreground"
                    aria-label={t('marksGrid.derivedCellLabel', { name: component.name })}
                  >
                    {derived[component.id]?.values[student.id] ?? '—'}
                  </td>
                ))}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

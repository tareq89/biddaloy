/**
 * [21.8.1] The section-week grid: columns are the tenant's working
 * weekdays (`TenantSettings.attendance.weeklyOffDays` filtered out —
 * never a hard-coded Mon-Fri, D18), rows are that section's shift's
 * period slots (`BREAK` rows span every column). No Epic 19.0 marks grid
 * exists yet in this codebase to clone (Epic 19 shipped spine-only) — the
 * keyboard model here is `attendance/-roster-marker.tsx`'s roving-tabIndex
 * pattern extended from one axis to two.
 *
 * Pure/presentational: this component owns focus and key handling, but
 * every write (`onActivateCell`, `onClearCell`) is the caller's job —
 * `$sectionId.tsx` is the one that knows how to save a cell and surface a
 * 409's violations.
 *
 * D18 narrow-viewport rule is plain CSS, not a resize listener: the
 * message and the grid are both always in the DOM, Tailwind's `md:`
 * breakpoint toggles which one is visible. Native platform feature over
 * a JS media-query hook.
 */
import { PlusIcon, TriangleAlertIcon } from 'lucide-react';
import * as React from 'react';

import { useRegionConfig, useTranslation } from '../i18n';
import { cn } from '../primitives/lib/utils';
import { formatTime } from '../utils/date';

export interface RoutineGridPeriodRow {
  id: string;
  sequence: number;
  kind: 'CLASS' | 'BREAK';
  name: string | null;
  starts_at: string;
  ends_at: string;
}

export interface RoutineGridCell {
  slotId: string;
  subjectLabel: string;
  teacherLabels: string[];
  recurrence: 'WEEKLY' | 'BIWEEKLY' | 'MONTHLY';
  hasViolation: boolean;
  hasWarning: boolean;
}

export interface RoutineGridProps {
  /** 0 (Sunday) .. 6 (Saturday), already filtered to working days and in
   * ascending order — this component never re-derives the off-day set. */
  weekdays: number[];
  weekdayLabels: Record<number, string>;
  periods: RoutineGridPeriodRow[];
  /** Keyed `"<weekday>:<periodSlotId>"`. Absent = empty cell. */
  cells: Record<string, RoutineGridCell>;
  onActivateCell: (weekday: number, periodSlotId: string) => void;
  onClearCell: (weekday: number, periodSlotId: string) => void;
  /** Fired on any printable-character keypress on a focused empty cell —
   * `$sectionId.tsx` opens the picker pre-filtered to this character. */
  onTypeAhead?: (weekday: number, periodSlotId: string, char: string) => void;
  disabled?: boolean;
}

export function routineCellKey(weekday: number, periodSlotId: string): string {
  return `${weekday}:${periodSlotId}`;
}

function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target.tagName === 'INPUT' || target.tagName === 'TEXTAREA';
}

export function RoutineGrid({
  weekdays,
  weekdayLabels,
  periods,
  cells,
  onActivateCell,
  onClearCell,
  onTypeAhead,
  disabled = false,
}: RoutineGridProps) {
  const { t } = useTranslation('routines');
  const config = useRegionConfig();
  const timeRange = (p: RoutineGridPeriodRow) =>
    `${formatTime(p.starts_at, config)} – ${formatTime(p.ends_at, config)}`;
  const classRows = periods.filter((p) => p.kind === 'CLASS');
  // [row, col] into classRows/weekdays — a BREAK row is never a focus
  // target, it has no cells of its own.
  const [focused, setFocused] = React.useState<[number, number]>([0, 0]);
  const cellRefs = React.useRef<Map<string, HTMLButtonElement>>(new Map());

  function moveFocus(row: number, col: number) {
    const clampedRow = Math.max(0, Math.min(classRows.length - 1, row));
    const clampedCol = Math.max(0, Math.min(weekdays.length - 1, col));
    setFocused([clampedRow, clampedCol]);
    const period = classRows[clampedRow];
    const weekday = weekdays[clampedCol];
    if (period && weekday !== undefined) {
      cellRefs.current.get(routineCellKey(weekday, period.id))?.focus();
    }
  }

  function handleKeyDown(event: React.KeyboardEvent<HTMLTableElement>) {
    if (isTypingTarget(event.target) || disabled) return;
    const [row, col] = focused;
    const period = classRows[row];
    const weekday = weekdays[col];
    if (!period || weekday === undefined) return;

    switch (event.key) {
      case 'ArrowRight':
        event.preventDefault();
        moveFocus(row, col + 1);
        return;
      case 'ArrowLeft':
        event.preventDefault();
        moveFocus(row, col - 1);
        return;
      case 'ArrowDown':
        event.preventDefault();
        moveFocus(row + 1, col);
        return;
      case 'ArrowUp':
        event.preventDefault();
        moveFocus(row - 1, col);
        return;
      case 'Home':
        event.preventDefault();
        moveFocus(row, 0);
        return;
      case 'End':
        event.preventDefault();
        moveFocus(row, weekdays.length - 1);
        return;
      case 'Enter':
        event.preventDefault();
        onActivateCell(weekday, period.id);
        return;
      case 'Delete':
      case 'Backspace':
        event.preventDefault();
        if (cells[routineCellKey(weekday, period.id)]) onClearCell(weekday, period.id);
        return;
      default: {
        if (event.key.length === 1 && !event.metaKey && !event.ctrlKey && !event.altKey) {
          onTypeAhead?.(weekday, period.id, event.key);
        }
      }
    }
  }

  return (
    <>
      {/* D18: below `md`, the grid is too cramped to be usable — a
          message replaces it rather than rendering a broken layout. */}
      <p className="text-text-secondary md:hidden">{t('grid.tooNarrow')}</p>
      <div className="hidden overflow-x-auto md:block">
        {/* eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions --
            Standard WAI-ARIA "composite widget" keydown delegation: the
            roving-tabIndex cell buttons below are the interactive elements
            (each independently operable with a real button role); this
            container-level handler only routes arrow/Enter/Delete/type-ahead
            keys to whichever cell button currently holds focus, the same
            pattern `-roster-marker.tsx`'s roving-tabIndex row uses. */}
        <table className="w-full border-separate border-spacing-0" onKeyDown={handleKeyDown}>
          <caption className="sr-only">{t('grid.caption')}</caption>
          <thead className="bg-muted text-label text-text-secondary">
            <tr>
              <th
                scope="col"
                className="h-10 w-52 border-b border-border-subtle px-4 text-start font-medium"
              >
                {t('grid.periodColumn')}
              </th>
              {weekdays.map((weekday) => (
                <th
                  key={weekday}
                  scope="col"
                  className="h-10 border-b border-border-subtle px-2 text-start font-medium"
                >
                  {weekdayLabels[weekday]}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {periods.map((period) => {
              if (period.kind === 'BREAK') {
                return (
                  <tr key={period.id}>
                    <td
                      colSpan={weekdays.length + 1}
                      className="h-8 border-b border-border-subtle bg-muted px-4 text-caption text-text-secondary"
                    >
                      {period.name ?? t('grid.breakUnnamed')} · {timeRange(period)}
                    </td>
                  </tr>
                );
              }
              const rowIndex = classRows.findIndex((p) => p.id === period.id);
              return (
                <tr key={period.id}>
                  <th
                    scope="row"
                    className="w-52 border-b border-border-subtle px-4 py-2 text-start align-top font-normal"
                  >
                    <span className="block font-medium">
                      {t('agenda.periodLabel', { sequence: period.sequence })}
                    </span>
                    <span className="block text-caption whitespace-nowrap text-text-secondary">
                      {timeRange(period)}
                    </span>
                  </th>
                  {weekdays.map((weekday, colIndex) => {
                    const key = routineCellKey(weekday, period.id);
                    const cell = cells[key];
                    const periodLabel = t('agenda.periodLabel', { sequence: period.sequence });
                    const weekdayLabel = weekdayLabels[weekday] ?? '';
                    const isFocusTarget = rowIndex === focused[0] && colIndex === focused[1];
                    return (
                      <td key={key} className="border-b border-border-subtle p-1 align-top">
                        <button
                          type="button"
                          ref={(node) => {
                            if (node) cellRefs.current.set(key, node);
                            else cellRefs.current.delete(key);
                          }}
                          disabled={disabled}
                          aria-label={
                            cell
                              ? t('routine.cellLabel', {
                                  ns: 'common',
                                  weekday: weekdayLabel,
                                  period: periodLabel,
                                  subject: cell.subjectLabel,
                                  teachers: cell.teacherLabels.join(', '),
                                })
                              : t('routine.cellLabelEmpty', {
                                  ns: 'common',
                                  weekday: weekdayLabel,
                                  period: periodLabel,
                                })
                          }
                          tabIndex={isFocusTarget ? 0 : -1}
                          onFocus={() => setFocused([rowIndex, colIndex])}
                          onClick={() => onActivateCell(weekday, period.id)}
                          data-state={
                            cell?.hasViolation ? 'violation' : cell?.hasWarning ? 'warning' : 'ok'
                          }
                          className={cn(
                            'flex min-h-14 w-full flex-col items-start gap-0.5 rounded-md border px-2 py-1.5 text-start outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
                            cell
                              ? 'border-border-subtle bg-surface'
                              : 'border-dashed border-border-subtle bg-transparent text-text-secondary',
                            cell?.hasViolation &&
                              'border-status-overdue-fg bg-status-overdue-bg text-status-overdue-fg',
                            !cell?.hasViolation &&
                              cell?.hasWarning &&
                              'border-status-due-fg bg-status-due-bg text-status-due-fg',
                          )}
                        >
                          {cell ? (
                            <>
                              <span className="flex items-center gap-1 font-medium">
                                {cell.hasWarning && !cell.hasViolation && (
                                  <TriangleAlertIcon className="size-3.5" aria-hidden="true" />
                                )}
                                {cell.subjectLabel}
                              </span>
                              <span className="text-caption text-text-secondary">
                                {cell.teacherLabels.join(', ')}
                              </span>
                              {cell.recurrence !== 'WEEKLY' && (
                                <span className="text-caption">
                                  {t(`grid.recurrence.${cell.recurrence}`)}
                                </span>
                              )}
                            </>
                          ) : (
                            <span className="flex items-center gap-1">
                              <PlusIcon className="size-3.5" aria-hidden="true" />
                              {t('grid.emptyCell')}
                            </span>
                          )}
                        </button>
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </>
  );
}

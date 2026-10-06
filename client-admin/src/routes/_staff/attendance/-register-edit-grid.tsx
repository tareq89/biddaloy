/**
 * [41.4.3] The editable month grid behind `/attendance/register?edit=1`.
 *
 * A `role="grid"` table over the loaded register matrix. It holds no state of
 * its own except which cell is focused: the page owns the draft (a map of
 * changed cells only, keyed `studentId|date`) and passes it in. A cell whose
 * draft equals the loaded value leaves the draft, so the changed count is
 * honest (`applyCell`).
 *
 * Keyboard (D12), roving tabindex: arrows move between editable cells (closed
 * days and future days are skipped), Home/End jump to the row's first/last
 * editable day, P/A/L/E set the status, Space flips PRESENT/ABSENT, Esc
 * cancels. A click cycles PRESENT > ABSENT > LATE > LEAVE. Ctrl/Cmd+S is the
 * page's (`register.tsx`), so it also works from the reason field.
 */
import { AttendanceStatus } from '@biddaloy/shared';
import type { RegisterMatrix } from '@biddaloy/ui/hooks';
import { useRegionConfig, useTranslation } from '@biddaloy/ui/i18n';
import { formatDate, formatNumber, parseServerDate } from '@biddaloy/ui/utils';
import * as React from 'react';

type T = ReturnType<typeof useTranslation>['t'];
type Marks = Record<string, AttendanceStatus | null | undefined>;

/** Changed cells only, keyed `studentId|date`. */
export type Draft = ReadonlyMap<string, AttendanceStatus>;

export const cellKey = (studentId: string, date: string) => `${studentId}|${date}`;

/** Letter shown in a day cell. Literal keys (not a computed `t()` key) so
 * `check-i18n-keys.mjs` can see them. An unknown status shows "?". */
export function abbrev(t: T, status: AttendanceStatus): string {
  switch (status) {
    case AttendanceStatus.PRESENT:
      return t('register.abbrev.PRESENT');
    case AttendanceStatus.ABSENT:
      return t('register.abbrev.ABSENT');
    case AttendanceStatus.LATE:
      return t('register.abbrev.LATE');
    case AttendanceStatus.LEAVE:
      return t('register.abbrev.LEAVE');
    default:
      return '?';
  }
}

export function toneClass(status: AttendanceStatus | null | undefined): string {
  if (status === AttendanceStatus.ABSENT) return 'font-semibold text-status-overdue-fg';
  if (status === AttendanceStatus.LATE) return 'text-status-due-fg';
  if (status === AttendanceStatus.LEAVE) return 'text-status-partial-fg';
  return '';
}

/** Literal per-status lookup, not `t(\`statusControl.status.${status}\`)` —
 * a computed key is invisible to `check-i18n-keys.mjs`. Reuses
 * `statusControl.status.*` ([9.6]) rather than a second copy under `register.*`. */
export function statusLabel(t: T, status: AttendanceStatus): string {
  switch (status) {
    case AttendanceStatus.PRESENT:
      return t('statusControl.status.PRESENT');
    case AttendanceStatus.ABSENT:
      return t('statusControl.status.ABSENT');
    case AttendanceStatus.LATE:
      return t('statusControl.status.LATE');
    case AttendanceStatus.LEAVE:
      return t('statusControl.status.LEAVE');
    default:
      // `row.marks` is cast (not validated) from server JSON — an unknown
      // member must not render as an empty cell, nor as a raw enum.
      return t('register.unknownStatus');
  }
}

const LETTER_STATUS: Record<string, AttendanceStatus> = {
  p: AttendanceStatus.PRESENT,
  a: AttendanceStatus.ABSENT,
  l: AttendanceStatus.LATE,
  e: AttendanceStatus.LEAVE,
};
const CLICK_CYCLE = [
  AttendanceStatus.PRESENT,
  AttendanceStatus.ABSENT,
  AttendanceStatus.LATE,
  AttendanceStatus.LEAVE,
];

export function loadedStatus(
  matrix: RegisterMatrix,
  studentId: string,
  date: string,
): AttendanceStatus | null {
  const row = matrix.rows.find((r) => r.student_id === studentId);
  return (row ? (row.marks as Marks)[date] : null) ?? null;
}

/** Set one cell in the draft; a value equal to the loaded one removes it. */
export function applyCell(
  draft: Draft,
  matrix: RegisterMatrix,
  studentId: string,
  date: string,
  status: AttendanceStatus,
): Draft {
  const next = new Map(draft);
  const key = cellKey(studentId, date);
  if (loadedStatus(matrix, studentId, date) === status) next.delete(key);
  else next.set(key, status);
  return next;
}

export interface RegisterEditGridProps {
  matrix: RegisterMatrix;
  draft: Draft;
  onDraftChange: (next: Draft) => void;
  /** Local `YYYY-MM-DD`; later dates are locked. */
  today: string;
  caption: string;
  onCancel: () => void;
}

export function RegisterEditGrid({
  matrix,
  draft,
  onDraftChange,
  today,
  caption,
  onCancel,
}: RegisterEditGridProps) {
  const { t } = useTranslation('attendance');
  const regionConfig = useRegionConfig();
  const { dates, rows } = matrix;
  const editable = dates.map((d) => d.is_working_day && d.date <= today);
  const firstEditable = editable.indexOf(true);
  const [active, setActive] = React.useState<{ r: number; c: number }>({
    r: 0,
    c: Math.max(firstEditable, 0),
  });
  const gridRef = React.useRef<HTMLTableElement>(null);

  const focusCell = (r: number, c: number) => {
    setActive({ r, c });
    gridRef.current?.querySelector<HTMLElement>(`[data-pos="${r},${c}"]`)?.focus();
  };

  const statusAt = (studentId: string, date: string) =>
    draft.get(cellKey(studentId, date)) ?? loadedStatus(matrix, studentId, date);

  const set = (r: number, c: number, status: AttendanceStatus) => {
    const row = rows[r];
    const date = dates[c];
    if (!row || !date || !editable[c]) return;
    onDraftChange(applyCell(draft, matrix, row.student_id, date.date, status));
  };

  const step = (c: number, dir: 1 | -1) => {
    for (let i = c + dir; i >= 0 && i < editable.length; i += dir) if (editable[i]) return i;
    return c;
  };

  const onCellKeyDown = (event: React.KeyboardEvent, r: number, c: number) => {
    const row = rows[r];
    const date = dates[c];
    if (!row || !date) return;
    const lower = event.key.toLowerCase();
    if (event.metaKey || event.ctrlKey || event.altKey) return;
    let handled = true;
    if (event.key === 'ArrowRight') focusCell(r, step(c, 1));
    else if (event.key === 'ArrowLeft') focusCell(r, step(c, -1));
    else if (event.key === 'ArrowDown') focusCell(Math.min(r + 1, rows.length - 1), c);
    else if (event.key === 'ArrowUp') focusCell(Math.max(r - 1, 0), c);
    else if (event.key === 'Home') focusCell(r, firstEditable);
    else if (event.key === 'End') focusCell(r, editable.lastIndexOf(true));
    else if (event.key === 'Escape') onCancel();
    else if (event.key === ' ') {
      const now = statusAt(row.student_id, date.date);
      set(
        r,
        c,
        now === AttendanceStatus.PRESENT ? AttendanceStatus.ABSENT : AttendanceStatus.PRESENT,
      );
    } else if (event.key.length === 1 && LETTER_STATUS[lower]) {
      set(r, c, LETTER_STATUS[lower]);
    } else handled = false;
    if (handled) event.preventDefault();
  };

  const onCellClick = (r: number, c: number) => {
    const row = rows[r];
    const date = dates[c];
    if (!row || !date) return;
    focusCell(r, c);
    const now = statusAt(row.student_id, date.date);
    const idx = now ? CLICK_CYCLE.indexOf(now) : -1;
    set(r, c, CLICK_CYCLE[(idx + 1) % CLICK_CYCLE.length] ?? AttendanceStatus.PRESENT);
  };

  return (
    <div
      role="region"
      aria-label={caption}
      className="relative w-full overflow-x-auto"
      // The grid itself is the tab stop (roving tabindex); the wrapper only scrolls.
    >
      <table
        ref={gridRef}
        role="grid"
        aria-label={caption}
        className="w-full border-collapse text-caption tabular-nums"
      >
        <thead className="border-b border-border-subtle bg-muted text-text-secondary">
          <tr>
            <th scope="col" className="h-9 px-2 text-start font-medium">
              {t('register.columnRoll')}
            </th>
            <th scope="col" className="h-9 px-2 text-start font-medium">
              {t('register.columnStudent')}
            </th>
            {dates.map((date) => (
              <th key={date.date} scope="col" className="h-9 min-w-8 text-center font-medium">
                <span aria-hidden="true">
                  {formatNumber(parseServerDate(date.date).getUTCDate(), regionConfig)}
                </span>
                <span className="sr-only">{formatDate(date.date, regionConfig)}</span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-border-subtle">
          {rows.map((row, r) => (
            <tr key={row.student_id}>
              <td className="h-9 px-2">{formatNumber(row.roll_number, regionConfig)}</td>
              <th scope="row" className="h-9 px-2 text-start font-medium whitespace-nowrap">
                {row.full_name}
              </th>
              {dates.map((date, c) => {
                if (!editable[c]) {
                  return (
                    <td
                      key={date.date}
                      role="gridcell"
                      aria-disabled="true"
                      className="h-9 bg-muted text-center text-text-secondary"
                    >
                      <span aria-hidden="true">—</span>
                      <span className="sr-only">
                        {date.is_working_day
                          ? t('register.notMarked')
                          : t('register.notWorkingDay')}
                      </span>
                    </td>
                  );
                }
                const status = statusAt(row.student_id, date.date);
                const changed = draft.has(cellKey(row.student_id, date.date));
                const label =
                  t('register.cellLabel', {
                    name: row.full_name,
                    date: formatDate(date.date, regionConfig),
                    status: status ? statusLabel(t, status) : t('register.notMarked'),
                  }) + (changed ? `, ${t('register.cellChanged')}` : '');
                return (
                  <td
                    key={date.date}
                    role="gridcell"
                    data-pos={`${r},${c}`}
                    data-changed={changed || undefined}
                    aria-label={label}
                    tabIndex={active.r === r && active.c === c ? 0 : -1}
                    onFocus={() => setActive({ r, c })}
                    onKeyDown={(e) => onCellKeyDown(e, r, c)}
                    onClick={() => onCellClick(r, c)}
                    className={`h-9 min-w-8 cursor-pointer text-center select-none focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring ${toneClass(status)} ${
                      changed ? 'ring-2 ring-primary ring-inset' : ''
                    }`}
                  >
                    <span aria-hidden="true">{status ? abbrev(t, status) : '·'}</span>
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

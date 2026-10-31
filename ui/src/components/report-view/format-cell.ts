/**
 * [8.15.26] Typed cell formatting and adding up for the report renderers.
 *
 * Every number, money amount and date goes through the shared formatters in `ui/src/utils` (the
 * same ones the dashboard charts use), so Bangla digits and the taka sign follow the school's
 * `RegionConfig`. Nothing here calls `Intl` directly.
 *
 * A count hidden for privacy (D14) arrives as `null` in a measure column while the run is
 * `suppressed`. It must never read as 0: `isHiddenCell` names that case so the caller can show a dash
 * with a tooltip in plain words (see `ReportCell`).
 */
import type { RegionConfig } from '../../i18n';
import { formatDate, formatScore, formatServerAmount } from '../../utils';

import type { ReportColumn, ReportColumnType } from './types';

export const DASH = '—';

/** Words a BOOLEAN cell needs; the caller passes translated text. */
export interface CellWords {
  yes: string;
  no: string;
}

const NUMERIC: ReadonlySet<ReportColumnType> = new Set(['NUMBER', 'MONEY', 'PERCENT']);
const ADDITIVE: ReadonlySet<ReportColumnType> = new Set(['NUMBER', 'MONEY']);

/** Numbers, money and percentages sit on the right and use tabular figures. */
export function isNumericType(type: ReportColumnType): boolean {
  return NUMERIC.has(type);
}

/** Only counts and money add up. A percentage or a date has no meaningful total. */
export function isAdditiveType(type: ReportColumnType): boolean {
  return ADDITIVE.has(type);
}

export function columnLabel(column: ReportColumn, locale: string): string {
  const [first, second] =
    locale === 'bn' ? [column.label_bn, column.label_en] : [column.label_en, column.label_bn];
  return first || second || column.key;
}

/** The server's numbers are numbers; tolerate a numeric string rather than print `NaN`. */
export function toNumber(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'string' && value.trim() !== '') {
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

/** True for a count the server hid for privacy: a `null` measure while the run is `suppressed`. */
export function isHiddenCell(value: unknown, column: ReportColumn, suppressed: boolean): boolean {
  return suppressed && column.kind === 'measure' && (value === null || value === undefined);
}

/** Text for one cell. Empty or unreadable values are `—`, never `0` and never `NaN`. */
export function formatCell(
  value: unknown,
  type: ReportColumnType,
  config: RegionConfig,
  words?: CellWords,
): string {
  if (value === null || value === undefined || value === '') return DASH;
  switch (type) {
    case 'NUMBER': {
      const n = toNumber(value);
      return n === null ? DASH : formatScore(n, config);
    }
    case 'PERCENT': {
      const n = toNumber(value);
      return n === null ? DASH : `${formatScore(n, config)}%`;
    }
    case 'MONEY': {
      const n = toNumber(value);
      return n === null ? DASH : formatServerAmount(n, config);
    }
    case 'DATE':
      return typeof value === 'string' || value instanceof Date ? formatDate(value, config) : DASH;
    case 'BOOLEAN':
      return value === true || value === 'true'
        ? (words?.yes ?? 'Yes')
        : value === false || value === 'false'
          ? (words?.no ?? 'No')
          : DASH;
    default:
      // A text value is a string; anything else the server sends is shown only if it is a plain scalar.
      return typeof value === 'string'
        ? value
        : typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint'
          ? String(value)
          : DASH;
  }
}

export interface AddedUp {
  /** `null` when the column cannot be added up (a percentage, a date) or nothing was readable. */
  value: number | null;
  /** True when at least one cell was hidden, so `value` would be too small to show. */
  incomplete: boolean;
}

/**
 * Adds up cells of one column. Money is added in whole paisa so 0.1 + 0.2 stays 0.30; counts are
 * added as they are. A hidden (`null`) cell cannot be added, so the result is flagged `incomplete`
 * and the renderer shows a dash instead of a total that is too small, and instead of a total that
 * would let someone work the hidden number out.
 */
export function addUp(values: readonly unknown[], type: ReportColumnType): AddedUp {
  if (!isAdditiveType(type)) return { value: null, incomplete: false };
  let sum = 0;
  let incomplete = false;
  let seen = false;
  for (const raw of values) {
    const n = toNumber(raw);
    if (n === null) {
      if (raw === null || raw === undefined) incomplete = true;
      continue;
    }
    seen = true;
    sum += type === 'MONEY' ? Math.round(n * 100) : n;
  }
  if (!seen) return { value: null, incomplete };
  return { value: type === 'MONEY' ? sum / 100 : sum, incomplete };
}

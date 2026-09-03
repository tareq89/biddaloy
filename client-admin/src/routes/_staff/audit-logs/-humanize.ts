/**
 * [8.11.10]'s "entries render in plain language, not raw JSON" acceptance
 * criterion, as pure functions — no React, no i18next, so every rule below
 * is unit-testable on its own and the panel that uses them stays a thin
 * rendering layer.
 *
 * An audit row's `old_values`/`new_values` are arbitrary JSONB the server
 * wrote from whatever entity was being changed. There is no schema to lean
 * on, so this module is deliberately defensive: anything it cannot render
 * as a sentence degrades to a compact, still-readable line rather than
 * throwing or dumping `{"a":{"b":[1,2]}}` at an administrator.
 */
import { Permission } from '@biddaloy/shared';
import type { RegionConfig } from '@biddaloy/ui/i18n';
import { formatDate, formatDateTime, formatNumber, parseServerDate } from '@biddaloy/ui/utils';

/** One row of the before/after table: a field present in `old_values`,
 * `new_values`, or both. */
export interface DiffField {
  key: string;
  before: unknown;
  after: unknown;
  changed: boolean;
}

type JsonRecord = Record<string, unknown>;

/** `Object.is` is wrong here (`NaN`/`-0` aside, it says two structurally
 * identical objects differ), and `JSON.stringify` comparison is wrong too
 * (key order flips the answer). This walks the two values instead. */
function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a === null || b === null || typeof a !== 'object' || typeof b !== 'object') return false;

  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
    return a.every((item, index) => deepEqual(item, b[index]));
  }

  const aEntries = Object.entries(a as JsonRecord);
  const bRecord = b as JsonRecord;
  if (aEntries.length !== Object.keys(bRecord).length) return false;
  return aEntries.every(
    ([key, value]) =>
      Object.prototype.hasOwnProperty.call(bRecord, key) && deepEqual(value, bRecord[key]),
  );
}

/**
 * The union of both snapshots' keys, in a stable order: everything
 * `old_values` had first (that is the order the record used to read in),
 * then whatever only `new_values` introduced.
 *
 * A key present in one snapshot and missing from the other counts as
 * changed — a field that appeared or disappeared is exactly the kind of
 * thing a dispute turns on.
 */
export function diffFields(
  oldValues: JsonRecord | null | undefined,
  newValues: JsonRecord | null | undefined,
): DiffField[] {
  const before = oldValues ?? {};
  const after = newValues ?? {};
  const keys = [
    ...Object.keys(before),
    ...Object.keys(after).filter((key) => !Object.prototype.hasOwnProperty.call(before, key)),
  ];

  return keys.map((key) => {
    const hasBefore = Object.prototype.hasOwnProperty.call(before, key);
    const hasAfter = Object.prototype.hasOwnProperty.call(after, key);
    return {
      key,
      before: hasBefore ? before[key] : undefined,
      after: hasAfter ? after[key] : undefined,
      changed: hasBefore !== hasAfter || !deepEqual(before[key], after[key]),
    };
  });
}

/** How many fields actually changed — the number the row's plain-language
 * summary interpolates ("3 fields changed on this student"). */
export function changedFieldCount(
  oldValues: JsonRecord | null | undefined,
  newValues: JsonRecord | null | undefined,
): number {
  return diffFields(oldValues, newValues).filter((field) => field.changed).length;
}

/**
 * A row with neither snapshot is an *event*, not an edit — LOGIN, LOGOUT,
 * LOGIN_FAILED, TOKEN_REUSE_DETECTED and friends. `DataTable`'s expansion
 * is table-level (every row gets a toggle), so the panel still opens; it
 * just says there were no field changes rather than rendering an empty
 * table.
 */
export function isEventOnly(
  oldValues: JsonRecord | null | undefined,
  newValues: JsonRecord | null | undefined,
): boolean {
  return diffFields(oldValues, newValues).length === 0;
}

/** Snapshot keys are the server's own column names. Rendered as a
 * sentence-cased label when no i18n entry exists for them: `full_name` →
 * "Full name", `academic_year_id` → "Academic year ID", `dueDate` →
 * "Due date". English-shaped by construction — a Bangla reader gets the
 * translated label for every key the `fields` namespace map covers, and
 * this fallback only for keys nobody has translated yet. */
export function humanizeFieldName(key: string): string {
  const words = key
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/_/g, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (words.length === 0) return key;

  return words
    .map((word, index) => {
      if (word.toLowerCase() === 'id') return 'ID';
      if (index > 0) return word.toLowerCase();
      return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
    })
    .join(' ');
}

/** `2026-01-05` and `2026-01-05T10:30:00.000Z` both mean "a date" to a
 * reader; anything else is left alone. */
const DATE_LIKE = /^\d{4}-\d{2}-\d{2}(T|$)/;

/** Last-resort rendering for a value no other rule fits: a nested object,
 * or something JSONB shouldn't contain but a hand-written
 * `AuditService.record()` call could. Never `String(value)` — that turns
 * an object into the useless `[object Object]`. */
function compactJson(value: unknown, fallback: string): string {
  try {
    return JSON.stringify(value) ?? fallback;
  } catch {
    // Circular structure — `redact.util.ts` already fails the audit write
    // open on one of these, so it should be unreachable from real data.
    return fallback;
  }
}

export interface HumanizeOptions {
  config: RegionConfig;
  /** Rendered for `null`/`undefined`/an absent key — an em dash, so an
   * empty cell is visibly "nothing" rather than ambiguously blank. */
  emptyValue: string;
  trueLabel: string;
  falseLabel: string;
  /** Translated field label, falling back to `humanizeFieldName`. Used for
   * the "key: value" lines a one-level-nested object flattens into. */
  fieldLabel: (key: string) => string;
}

function humanizeScalar(value: unknown, options: HumanizeOptions): string {
  if (value === null || value === undefined) return options.emptyValue;
  if (typeof value === 'boolean') return value ? options.trueLabel : options.falseLabel;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return String(value);
    // Money is stored as a decimal string on the wire, so a bare `number`
    // here is a count, a roll number or a percentage — `formatNumber`'s
    // job, not `formatServerAmount`'s. Fractions are preserved rather
    // than rounded away: an audit trail that silently rounds is worse
    // than one that shows an awkward number.
    const decimals = Number.isInteger(value) ? 0 : (String(value).split('.')[1]?.length ?? 0);
    return formatNumber(value, options.config, { decimals });
  }
  if (typeof value === 'string') {
    if (DATE_LIKE.test(value)) {
      try {
        // A full timestamp keeps its time. Formatting `…T10:30:00Z` and
        // `…T18:00:00Z` with `formatDate` would render both as the same
        // date, so the panel would mark the row "Changed" while showing
        // an identical Before and After — the change made unrecoverable
        // by the very screen meant to reveal it. `parseServerDate` slices
        // to the date part, so the timestamp branch parses the raw string.
        // `parseServerDate` first in both branches — it throws on an
        // impossible calendar date, where `new Date('2026-02-30T…')`
        // silently rolls over to 2026-03-02. An audit trail must never
        // invent a date that was not recorded.
        parseServerDate(value);
        if (value.includes('T')) {
          const parsed = new Date(value);
          // A valid date with a garbage time (`…T99:99`) is Invalid Date
          // rather than a throw, so it needs its own check to reach the
          // same fallback.
          if (Number.isNaN(parsed.getTime())) return value;
          return formatDateTime(parsed, options.config);
        }
        return formatDate(parseServerDate(value), options.config);
      } catch {
        // A date-shaped string that isn't a real calendar date
        // (`2026-02-30`) — show what was actually recorded rather than
        // inventing a date or crashing the panel.
        return value;
      }
    }
    return value === '' ? options.emptyValue : value;
  }
  if (typeof value === 'bigint') return value.toString();
  return compactJson(value, options.emptyValue);
}

/**
 * A snapshot value as display lines. One line for a scalar; one line per
 * entry for a one-level object (`Amount: 1,500`); one line per item for an
 * array. Anything deeper than one level falls back to compact JSON on a
 * single line — rare, honest, and still far short of dumping the whole
 * record.
 */
export function humanizeValue(value: unknown, options: HumanizeOptions): string[] {
  if (value === null || value === undefined) return [options.emptyValue];

  if (Array.isArray(value)) {
    if (value.length === 0) return [options.emptyValue];
    return value.map((item) =>
      item !== null && typeof item === 'object'
        ? compactJson(item, options.emptyValue)
        : humanizeScalar(item, options),
    );
  }

  if (typeof value === 'object') {
    const entries = Object.entries(value as JsonRecord);
    if (entries.length === 0) return [options.emptyValue];
    return entries.map(([key, nested]) => {
      const rendered =
        nested !== null && typeof nested === 'object'
          ? compactJson(nested, options.emptyValue)
          : humanizeScalar(nested, options);
      return `${options.fieldLabel(key)}: ${rendered}`;
    });
  }

  return [humanizeScalar(value, options)];
}

/** The "What" column's entity reference: an audit row's `entity_id` is a
 * UUID, and all 36 characters of it in a table cell is noise. The first
 * segment is enough to tell two rows apart and to match against a URL. */
export function shortEntityId(entityId: string | null): string | null {
  if (!entityId) return null;
  return entityId.split('-')[0] ?? entityId;
}

export interface AuditEntityRoute {
  to:
    | '/students/$studentId'
    | '/invoices/$invoiceId'
    | '/staff/$userId'
    | '/communications/batches/$batchId';
  paramKey: 'studentId' | 'invoiceId' | 'userId' | 'batchId';
  permission: Permission;
}

/** [8.14.13]: maps an audit row's `entity_type` to the detail page it
 * links to, and the permission the active role needs to open it. `null`
 * means "no detail route exists for this entity type in client-admin" —
 * `Payment` (no `/payments/:id` detail route, only `record.tsx`),
 * `FeeStructure`, `School`, and `ReminderBatchPreview` all stay plain
 * text for that reason; see [8.14.13]'s plan for why `Payment` in
 * particular was left out despite the issue asking for it. */
export function auditEntityRoute(entityType: string): AuditEntityRoute | null {
  switch (entityType) {
    case 'Student':
      return {
        to: '/students/$studentId',
        paramKey: 'studentId',
        permission: Permission.STUDENT_READ,
      };
    case 'Invoice':
      return {
        to: '/invoices/$invoiceId',
        paramKey: 'invoiceId',
        permission: Permission.INVOICE_READ,
      };
    case 'User':
      return { to: '/staff/$userId', paramKey: 'userId', permission: Permission.USER_READ };
    case 'ReminderBatch':
      return {
        to: '/communications/batches/$batchId',
        paramKey: 'batchId',
        permission: Permission.COMMUNICATION_BULK_SEND,
      };
    default:
      return null;
  }
}

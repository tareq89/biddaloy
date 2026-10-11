import type { RowError } from './tab-spec';

/**
 * Storage keys created by `tenantObjectKey` look like
 * `tenants/<school id>/<area>/<uuid>.<ext>`. A workbook restored into a DIFFERENT
 * school must not keep the source school's id in a key it stores, or the new row
 * would let that school stream the source school's file through the normal
 * authenticated routes (they stream by the stored key).
 *
 * `rehomeStorageKey` swaps a foreign school id for the destination's. The object
 * isn't copied, so the key dangles (a 404) until the file is re-uploaded — a
 * safe failure, never a leak. Keys that aren't under `tenants/` are not this
 * function's business and are reported as `null`.
 */
const TENANT_KEY = /^tenants\/([^/]+)\/(.+)$/;

export interface RehomedKey {
  /** The key to store: the input if it already belongs to `tenantId`, otherwise the rewritten one. */
  key: string;
  /** The tenant-independent part, e.g. `print-assets/<uuid>.png`. Stable across schools. */
  tail: string;
  /** True if the key came from another school and was rewritten. */
  moved: boolean;
}

export function rehomeStorageKey(storageKey: string, tenantId: string): RehomedKey | null {
  const match = TENANT_KEY.exec(storageKey);
  if (!match || storageKey.includes('..') || match[1] === '' || match[2] === undefined) return null;
  const [, sourceTenant, tail] = match;
  if (sourceTenant === tenantId) return { key: storageKey, tail, moved: false };
  return { key: `tenants/${tenantId}/${tail}`, tail, moved: true };
}

/**
 * Restore-side gate for any storage key a workbook cell carries (DATA-02). A key
 * outside `tenants/` (e.g. `backups/db/...`) or containing `..` is a row error;
 * another school's key is rewritten to this school's prefix, with a warning that
 * the file was not copied. A foreign key is therefore never stored.
 *
 * `area` is the folder the column's upload code writes to (the `category` passed
 * to `tenantObjectKey`, e.g. `staff-documents`). When given, a key in any other
 * folder of the school is also a row error, so a restored row can't point a
 * download/replace route at, say, the school's own workbook backup.
 */
export function ownStorageKey(
  raw: string,
  tenantId: string,
  tab: string,
  rowNo: number,
  column: string,
  area?: string,
): { key: string; warning?: RowError } | { error: RowError } {
  const rehomed = rehomeStorageKey(raw, tenantId);
  if (!rehomed || (area !== undefined && !rehomed.tail.startsWith(`${area}/`))) {
    return {
      error: {
        tab,
        row: rowNo,
        column,
        message: `Column "${column}": "${raw}" is not a valid storage key for this school.`,
        severity: 'error',
        value: raw,
      },
    };
  }
  if (!rehomed.moved) return { key: rehomed.key };
  return {
    key: rehomed.key,
    warning: {
      tab,
      row: rowNo,
      column,
      message: 'This file came from another school. It was not copied; upload it again.',
      severity: 'warning',
      value: raw,
    },
  };
}

/**
 * Runs `ownStorageKey` over the `field` of every element of a JSON array cell
 * (homework `attachments[].key`, admission `documents[].storage_key`). Any element
 * without a string key, or with an out-of-scope one, rejects the row. Warnings are
 * returned, not emitted, so the caller reports them only if the row is accepted.
 */
export function ownKeysIn(
  items: unknown[],
  tenantId: string,
  tab: string,
  rowNo: number,
  opts: { column: string; field: string; area?: string },
): { items: unknown[]; warnings: RowError[] } | { error: RowError } {
  const out: unknown[] = [];
  const warnings: RowError[] = [];
  for (const item of items) {
    const raw = (item as Record<string, unknown> | null)?.[opts.field];
    const result = ownStorageKey(
      typeof raw === 'string' ? raw : '',
      tenantId,
      tab,
      rowNo,
      opts.column,
      opts.area,
    );
    if ('error' in result) return result;
    if (result.warning) warnings.push(result.warning);
    out.push({ ...(item as object), [opts.field]: result.key });
  }
  return { items: out, warnings };
}

/** `tenants/<id>/print-assets/x.png` -> `print-assets/x.png`; anything else is returned as-is. */
export const storageKeyTail = (storageKey: string): string =>
  TENANT_KEY.exec(storageKey)?.[2] ?? storageKey;

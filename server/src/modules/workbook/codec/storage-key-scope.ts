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

/** `tenants/<id>/print-assets/x.png` -> `print-assets/x.png`; anything else is returned as-is. */
export const storageKeyTail = (storageKey: string): string =>
  TENANT_KEY.exec(storageKey)?.[2] ?? storageKey;

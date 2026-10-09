/**
 * Print templates point at uploaded assets by id, inside their JSON:
 *   background.assetId · IMAGE element assetId · TEXT element fontAssetId
 *
 * A restore INSERTS new rows with fresh UUIDs (the codec never carries ids over
 * for new rows), so those ids would dangle after a restore. On export they are
 * swapped for the asset's tenant-independent key; on import they are swapped
 * back for the restored row's id. The walk is by key name, so it also covers any
 * future element that reuses `assetId` / `fontAssetId`.
 */
const ASSET_ID_KEYS = new Set(['assetId', 'fontAssetId']);

/** Deep-copies `value`, replacing every string `assetId` / `fontAssetId` with `map(it)`. */
export function mapAssetRefs(value: unknown, map: (assetRef: string) => string): unknown {
  if (Array.isArray(value)) return value.map((v) => mapAssetRefs(v, map));
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([k, v]) => [
        k,
        ASSET_ID_KEYS.has(k) && typeof v === 'string' ? map(v) : mapAssetRefs(v, map),
      ]),
    );
  }
  return value;
}

/** Every asset reference in `value` (used to report the ones that don't resolve). */
export function collectAssetRefs(value: unknown, into: string[] = []): string[] {
  mapAssetRefs(value, (ref) => {
    into.push(ref);
    return ref;
  });
  return into;
}

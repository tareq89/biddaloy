import { randomUUID } from 'crypto';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CATEGORY_RE = /^[a-z-]+$/;

/** File extensions this module is willing to write. Anything not on this
 * list is refused rather than passed through — a caller that needs a new
 * extension adds it here deliberately, rather than the key builder trusting
 * arbitrary caller input. */
const ALLOWED_EXTENSIONS = new Set(['png', 'jpg', 'jpeg', 'webp', 'pdf', 'csv', 'xlsx']);

/**
 * The only way to build an object key for tenant-scoped storage. Keys are
 * always `tenants/<tenantId>/<category>/<randomUUID>.<ext>` — the random
 * filename component means a caller can never target or overwrite another
 * object by guessing or supplying a path, and there is no way to construct
 * a key containing `..` or a stray `/`, so path traversal out of a tenant's
 * prefix is impossible by construction rather than by validation alone.
 *
 * Example: `tenantObjectKey('3fa85f64-5717-4562-b3fc-2c963f66afa6', 'avatars', 'png')`
 * → `tenants/3fa85f64-5717-4562-b3fc-2c963f66afa6/avatars/<uuid>.png`
 */
export function tenantObjectKey(tenantId: string, category: string, ext: string): string {
  if (!UUID_RE.test(tenantId)) {
    throw new Error(`tenantObjectKey: tenantId must be a UUID, got "${tenantId}"`);
  }
  if (!CATEGORY_RE.test(category)) {
    throw new Error(
      `tenantObjectKey: category must match ${CATEGORY_RE}, got "${category}"`,
    );
  }
  const normalizedExt = ext.toLowerCase();
  if (!ALLOWED_EXTENSIONS.has(normalizedExt)) {
    throw new Error(
      `tenantObjectKey: extension "${ext}" is not allowed (allowed: ${[...ALLOWED_EXTENSIONS].join(', ')})`,
    );
  }

  return `tenants/${tenantId}/${category}/${randomUUID()}.${normalizedExt}`;
}

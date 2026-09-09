/**
 * [15.5.4] The two directions between a stored logo object key and the
 * `v=<uuid>` a client uses to ask for that exact object.
 *
 * Keys come from `tenantObjectKey(schoolId, 'logo', 'png')`, so they always
 * look like `tenants/<schoolId>/logo/<uuid>.png`. The `<uuid>` part is the
 * "version": a fresh upload gets a new key (so a new `v`), and a document's
 * `IssuerSnapshot.logo_key` keeps pointing at the object that was current
 * when it was issued. Logo objects are never deleted on replace/remove for
 * exactly that reason — see `SchoolLogoService`.
 */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** `tenants/<id>/logo/<uuid>.png` → `<uuid>`. */
export function logoVersionFromKey(logoKey: string): string {
  const filename = logoKey.split('/').pop() ?? '';
  return filename.replace(/\.[^.]+$/, '');
}

/** `/schools/<id>/logo?v=<uuid>`, or `null` when the school has no logo.
 * Relative to the API base — the client fetches it through its
 * authenticated API client, never as a bare `<img src>`. */
export function buildLogoUrl(schoolId: string, logoKey: string | null): string | null {
  if (!logoKey) return null;
  return `/schools/${schoolId}/logo?v=${logoVersionFromKey(logoKey)}`;
}

/** The storage key for `version` of `schoolId`'s logo. The key is always
 * built from the *caller's* school id (never trusted from the request), so a
 * version can only ever address an object under that school's own prefix. */
export function logoKeyForVersion(schoolId: string, version: string): string | null {
  if (!UUID_RE.test(version)) return null;
  return `tenants/${schoolId}/logo/${version.toLowerCase()}.png`;
}

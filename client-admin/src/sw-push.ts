/**
 * Pure, testable helpers for the service worker's `push` and
 * `notificationclick` handlers ([15.7], #556). No `self`/service-worker
 * globals are referenced here — `sw.ts` calls into these and does the
 * actual `self.registration` / `self.clients` work.
 */

export const DEFAULT_NOTIFICATION_URL = '/portal';

export interface PushPayload {
  type: string;
  title: string;
  body: string;
  url: string;
}

/** A same-origin path only: starts with a single "/", never "//", never a scheme. */
export function isSameOriginPath(url: unknown): url is string {
  if (typeof url !== 'string' || url.length === 0) return false;
  if (!url.startsWith('/')) return false;
  if (url.startsWith('//')) return false;
  // A leading "/x:y" is still a path, not a scheme — schemes only matter
  // before the first "/". Reject any colon before the first slash-delimited
  // segment ends, which also catches things like "/\evil.com".
  if (/^\/[^/]*:/.test(url)) return false;
  return true;
}

/**
 * Parses and validates a `push` event's JSON payload. Returns `null` for
 * anything that isn't a fully-formed, same-origin-safe payload — the
 * caller must ignore the event silently in that case (no notification).
 */
export function parsePushPayload(raw: unknown): PushPayload | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const { type, title, body, url } = raw as Record<string, unknown>;
  if (typeof type !== 'string' || typeof title !== 'string' || typeof body !== 'string') {
    return null;
  }
  if (!isSameOriginPath(url)) return null;
  return { type, title, body, url };
}

export interface MinimalWindowClient {
  url: string;
}

export interface FocusDecision<C extends MinimalWindowClient> {
  kind: 'focus' | 'open';
  client?: C;
  url: string;
}

/**
 * Given the list of open window clients and a target url, decides whether
 * to focus (and navigate) an existing client or open a new window.
 * Prefers a client already at the target url; otherwise falls back to the
 * first client in the list.
 */
export function pickClientOrOpen<C extends MinimalWindowClient>(
  clientList: readonly C[],
  url: string = DEFAULT_NOTIFICATION_URL,
): FocusDecision<C> {
  if (clientList.length === 0) {
    return { kind: 'open', url };
  }
  const atTarget = clientList.find((client) => client.url === url);
  // Non-null: `clientList` is non-empty here, so `clientList[0]` always exists.
  const client = atTarget ?? clientList[0]!;
  return { kind: 'focus', client, url };
}

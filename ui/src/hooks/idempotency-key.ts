import * as React from 'react';

/** FNV-1a 32-bit. Non-crypto: only names a sessionStorage slot, never stores the body itself
 * (it can hold names and phones). */
function hashBody(json: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < json.length; i++) {
    h ^= json.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(36);
}

const slot = (json: string) => `idempotency-key:${hashBody(json)}`;

/**
 * [2594] One `Idempotency-Key` per submit attempt. `keyFor(body)` returns the same key while
 * the body is unchanged (a re-send of the same attempt) and a fresh one when it differs, so a
 * dialog that stays mounted never replays an old key for a different selection. Call
 * `rotate()` on success so the next, identical-looking submit is a new attempt.
 * Same ref pattern as the SMS credit grant card.
 *
 * [2951] The key also survives a reload of the same tab: it is kept in `sessionStorage` under a
 * hash of the body, so "submit, reply lost, reload, submit again" re-sends the same key and the
 * server replays instead of creating a second record. Storage failures fall back to the ref
 * alone (fails silently, like `useFormAutosave`).
 *
 * ponytail: a 32-bit hash can collide; the server key also includes method + URL + tenant +
 * user (`idempotency.interceptor.ts`), so a clash needs the same route too.
 */
export function useIdempotencyKey(): { keyFor: (body: unknown) => string; rotate: () => void } {
  const held = React.useRef<{ json: string; key: string } | undefined>(undefined);
  return React.useMemo(
    () => ({
      keyFor(body: unknown) {
        const json = JSON.stringify(body);
        if (held.current?.json !== json) {
          let key: string | null = null;
          try {
            key = sessionStorage.getItem(slot(json));
          } catch {
            // storage blocked: ref-only
          }
          if (!key) {
            key = crypto.randomUUID();
            try {
              sessionStorage.setItem(slot(json), key);
            } catch {
              // storage blocked: ref-only
            }
          }
          held.current = { json, key };
        }
        return held.current.key;
      },
      rotate() {
        if (held.current) {
          try {
            sessionStorage.removeItem(slot(held.current.json));
          } catch {
            // storage blocked: ref-only
          }
        }
        held.current = undefined;
      },
    }),
    [],
  );
}

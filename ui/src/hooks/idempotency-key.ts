import * as React from 'react';

/**
 * [2594] One `Idempotency-Key` per submit attempt. `keyFor(body)` returns the same key while
 * the body is unchanged (a re-send of the same attempt) and a fresh one when it differs, so a
 * dialog that stays mounted never replays an old key for a different selection. Call
 * `rotate()` on success so the next, identical-looking submit is a new attempt.
 * Same ref pattern as the SMS credit grant card.
 */
export function useIdempotencyKey(): { keyFor: (body: unknown) => string; rotate: () => void } {
  const held = React.useRef<{ json: string; key: string } | undefined>(undefined);
  return React.useMemo(
    () => ({
      keyFor(body: unknown) {
        const json = JSON.stringify(body);
        if (held.current?.json !== json) held.current = { json, key: crypto.randomUUID() };
        return held.current.key;
      },
      rotate() {
        held.current = undefined;
      },
    }),
    [],
  );
}

import { Transform } from 'class-transformer';

// A dynamic require rather than `import { sanitizeStrict } from '@biddaloy/shared'`:
// under this repo's vitest config (`resolve.alias` pointing @biddaloy/shared at the
// workspace's own src/ instead of node_modules), a static named import of anything
// added to that barrel after its original four exports silently binds to `undefined`
// — reproduced and isolated to Vite/vite-node's own SSR module handling for this
// aliased specifier, independent of unplugin-swc, dist staleness, or any cache this
// investigation could locate on disk. A dynamic require of the same specifier always
// resolves correctly. Production (`tsc`/`nest build`) is unaffected either way — it
// never uses this Vite-only alias.
const shared = require('@biddaloy/shared') as typeof import('@biddaloy/shared');

/**
 * Strips all HTML markup from a free-text field on the way in (before
 * validation runs, via the global ValidationPipe's `transform: true`), so
 * every consumer of the stored value — SPAs, outbound SMS/email/WhatsApp —
 * gets already-clean text. This does not replace output encoding: a field
 * rendered into HTML must still be escaped there for its own context.
 *
 * Non-string values pass through untouched so class-validator's own type
 * decorators (e.g. `@IsString()`) still catch the type mismatch.
 */
export function SanitizeText(): PropertyDecorator {
  return Transform(({ value }) =>
    typeof value === 'string' ? shared.sanitizeStrict(value) : value,
  );
}

/**
 * Same as `SanitizeText()` but keeps a caller-supplied set of tags/attributes
 * instead of stripping everything. Not currently used by any field — every
 * free-text field in this app is strip-all — but available for the day a
 * field genuinely needs to hold rich text.
 */
export function SanitizeAllowlist(
  allowedTags: string[],
  allowedAttributes?: Record<string, string[]>,
): PropertyDecorator {
  return Transform(({ value }) =>
    typeof value === 'string'
      ? shared.sanitizeAllowlist(value, allowedTags, allowedAttributes)
      : value,
  );
}

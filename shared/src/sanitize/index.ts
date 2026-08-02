import sanitizeHtml from 'sanitize-html';

const RESIDUAL_ENTITIES: Record<string, string> = { '&amp;': '&', '&lt;': '<', '&gt;': '>' };

/**
 * sanitize-html re-escapes bare `&`/`<`/`>` left over in text nodes (so its
 * output is safe to re-embed as HTML) — but sanitizeStrict's callers store
 * plain text, not HTML, so "Tom & Jerry" must persist as-is rather than
 * "Tom &amp; Jerry". Output encoding for HTML contexts is the renderer's job,
 * not storage's (see server/README.md's sanitization note).
 *
 * A single combined-alternation regex, not `.replace().replace().replace()`:
 * chained sequential replacements can double-decode a nested entity like
 * "&amp;lt;" (first pass turns it into "&lt;", second pass then decodes that
 * into "<") — flagged independently by CodeQL's double-escaping/unescaping
 * check. This does exactly one substitution per match.
 *
 * Only for sanitizeStrict — never call this on sanitizeAllowlist's output,
 * which is real HTML meant for direct rendering. Decoding there would let a
 * disallowed tag that sanitize-html safely escaped as text (e.g. an
 * `<img onerror=...>` typed as literal characters) come back as live markup.
 */
function decodeResidualEntitiesForPlainText(value: string): string {
  return value.replace(/&amp;|&lt;|&gt;/g, (match) => RESIDUAL_ENTITIES[match]);
}

function normalize(input: string): string {
  return input.normalize('NFKC').trim();
}

/**
 * Strips all markup. The default policy — no free-text field in this app
 * currently has a legitimate reason to hold HTML.
 */
export function sanitizeStrict(input: string): string {
  const stripped = sanitizeHtml(normalize(input), { allowedTags: [], allowedAttributes: {} });
  return decodeResidualEntitiesForPlainText(stripped);
}

/**
 * Keeps a caller-supplied set of tags/attributes, strips everything else.
 * Unused today (every current free-text field is strip-all) but kept
 * available per the ticket's two-policy design for when a field genuinely
 * needs to hold rich text.
 *
 * Returns sanitize-html's output verbatim — no residual-entity decoding.
 * This is real HTML meant for direct rendering (e.g. dangerouslySetInnerHTML
 * on the client), so it must stay properly escaped; see the note on
 * decodeResidualEntitiesForPlainText.
 */
export function sanitizeAllowlist(
  input: string,
  allowedTags: string[],
  allowedAttributes: Record<string, string[]> = {},
): string {
  return sanitizeHtml(normalize(input), { allowedTags, allowedAttributes });
}

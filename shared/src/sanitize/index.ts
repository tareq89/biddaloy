import sanitizeHtml from 'sanitize-html';

/**
 * sanitize-html re-escapes bare `&`/`<`/`>` left over in text nodes (so its
 * output is safe to re-embed as HTML) — but callers here store plain text,
 * not HTML, so "Tom & Jerry" must persist as-is rather than "Tom &amp; Jerry".
 * Output encoding for HTML contexts is the renderer's job, not storage's
 * (see server/README.md's sanitization note).
 */
function decodeResidualEntities(value: string): string {
  return value.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>');
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
  return decodeResidualEntities(stripped);
}

/**
 * Keeps a caller-supplied set of tags/attributes, strips everything else.
 * Unused today (every current free-text field is strip-all) but kept
 * available per the ticket's two-policy design for when a field genuinely
 * needs to hold rich text.
 */
export function sanitizeAllowlist(
  input: string,
  allowedTags: string[],
  allowedAttributes: Record<string, string[]> = {},
): string {
  const stripped = sanitizeHtml(normalize(input), { allowedTags, allowedAttributes });
  return decodeResidualEntities(stripped);
}

/**
 * Client-side mirror of `reminder-template.util.ts`'s placeholder
 * allowlist. The server answers 400 `Unsupported template placeholder(s)`
 * for anything else; validating here means the composer learns about a
 * typo (`{{studnet_name}}`) while typing, not after a round trip — and
 * the four supported tokens can be named in the error.
 */
export const SUPPORTED_PLACEHOLDERS = [
  '{{student_name}}',
  '{{guardian_name}}',
  '{{due_amount}}',
  '{{due_month}}',
] as const;

const SUPPORTED_NAMES = new Set(['student_name', 'guardian_name', 'due_amount', 'due_month']);

// Same semantics as the server's PLACEHOLDER_PATTERN
// (`/\{\{\s*([^{}]*?)\s*\}\}/` in reminder-template.util.ts): inner
// whitespace padding is trimmed before the name is checked, so
// `{{ guardian_name }}` is as valid here as it is server-side.
const PLACEHOLDER_PATTERN = /\{\{\s*([^{}]*?)\s*\}\}/g;

/** Every `{{…}}` token in the template that the server would reject,
 * reported in normalized `{{name}}` form (padding stripped, matching how
 * the server's own 400 lists them). */
export function findUnsupportedPlaceholders(template: string): string[] {
  const unsupported: string[] = [];
  for (const match of template.matchAll(PLACEHOLDER_PATTERN)) {
    const name = match[1] ?? '';
    const normalized = `{{${name}}}`;
    if (!SUPPORTED_NAMES.has(name) && !unsupported.includes(normalized)) {
      unsupported.push(normalized);
    }
  }
  return unsupported;
}

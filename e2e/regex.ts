/** Escape regex metacharacters in a literal string before passing it to
 * `new RegExp(...)` — school/student/etc. names come from seed data or
 * user input and can contain `+`, `.`, `[`, `(` and the like, which
 * would otherwise change what the pattern matches or throw. */
export function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

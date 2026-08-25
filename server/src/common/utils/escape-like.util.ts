/**
 * Escapes SQL LIKE/ILIKE metacharacters (`%`, `_`, and the escape
 * character `\` itself) so user-supplied search text matches literally
 * instead of acting as wildcards. Postgres uses `\` as the default
 * LIKE escape character, so callers can embed the result directly in a
 * parameterized `ILIKE :search` pattern.
 */
export function escapeLikePattern(input: string): string {
  return input.replace(/[\\%_]/g, (char) => `\\${char}`);
}

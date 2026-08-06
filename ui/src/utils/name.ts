/**
 * Whitespace normalization only — trims and collapses internal runs of
 * whitespace (a name pasted from a spreadsheet cell, or typed on a mobile
 * keyboard with an accidental double space, is the realistic input this
 * guards against). Deliberately does **not** re-case anything: Bangladeshi
 * names routinely carry prefixes (`Md.`, `Mst.`) and honorifics that a
 * naive title-case would mangle, and the issue's own acceptance criteria
 * don't specify a casing rule to encode — guessing one here would be
 * inventing a requirement, not implementing one.
 */
export function formatName(input: string): string {
  return input.trim().replace(/\s+/g, ' ');
}

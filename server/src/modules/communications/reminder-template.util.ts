/**
 * Placeholder substitution for bulk reminder message templates.
 *
 * Kept as pure functions rather than service methods so the substitution
 * rules can be tested directly, the way invoice-numbering.util.ts and
 * fee-dues.service.ts's sortAggregates are.
 */

export const SUPPORTED_PLACEHOLDERS = [
  'student_name',
  'guardian_name',
  'due_amount',
  'due_month',
  // [9.8] absence-notice placeholders.
  'student_names',
  'date',
  'section_name',
  'school_name',
] as const;

export type SupportedPlaceholder = (typeof SUPPORTED_PLACEHOLDERS)[number];

/**
 * Partial, not a full `Record`: no single caller fills every placeholder in
 * `SUPPORTED_PLACEHOLDERS` at once — the fee path supplies
 * `due_amount`/`due_month`, [9.8]'s absence notice supplies
 * `student_names`/`date`/`section_name`/`school_name`, and both share
 * `student_name`/`guardian_name`. `renderReminderTemplate` already leaves an
 * unresolved placeholder verbatim (see below), so a caller-specific subset
 * of vars is exactly what the render path tolerates.
 */
export type ReminderTemplateVars = Partial<Record<SupportedPlaceholder, string>>;

export function isSupportedPlaceholder(name: string): name is SupportedPlaceholder {
  return (SUPPORTED_PLACEHOLDERS as readonly string[]).includes(name);
}

/** Narrows an arbitrary placeholder name before indexing the vars. */
export function templateVarValue(vars: ReminderTemplateVars, name: string): string | undefined {
  return isSupportedPlaceholder(name) ? vars[name] : undefined;
}

// Captures anything between the braces — not just [a-zA-Z0-9_] — so a typo
// like `{{student-name}}` is still recognized as a placeholder attempt and
// validated (and rejected) rather than silently skipped by the pattern and
// shipped to a guardian's phone as literal text.
//
// Deliberately has no `\s*` padding around a lazy capture: `\s` is a subset
// of `[^{}]`, so `\{\{\s*([^{}]*?)\s*\}\}` made the whitespace ambiguous
// between three parts of the pattern and backtracked polynomially on a
// staff-authored template holding a long run of spaces with no closing
// braces (CodeQL js/polynomial-redos). One unambiguous capture matches in
// linear time; both call sites trim the name themselves, so
// `{{ student_name }}` still resolves exactly as before.
const PLACEHOLDER_PATTERN = /\{\{([^{}]*)\}\}/g;

const MONTH_NAMES = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

/**
 * Names used in a template that this renderer cannot fill.
 *
 * The bulk endpoint rejects these up front instead of rendering them as
 * empty or leaving the braces in — a typo like `{{student}}` would otherwise
 * only be discovered by whoever reads the SMS, after it went to everyone.
 */
export function findUnsupportedPlaceholders(template: string): string[] {
  const found = new Set<string>();
  for (const match of template.matchAll(PLACEHOLDER_PATTERN)) {
    const name = match[1].trim();
    if (!isSupportedPlaceholder(name)) {
      found.add(name);
    }
  }
  return [...found];
}

export function renderReminderTemplate(template: string, vars: ReminderTemplateVars): string {
  return template.replace(PLACEHOLDER_PATTERN, (original: string, name: string) => {
    // Unsupported names are validated away before this runs; if one slips
    // through, leaving it verbatim is more diagnosable than an empty gap.
    return templateVarValue(vars, name.trim()) ?? original;
  });
}

/** Grouped to two decimals, matching how amounts read on a fee receipt. */
export function formatDueAmount(amount: number): string {
  return amount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function formatDueMonth(month: number, year: number): string {
  const name = MONTH_NAMES[month - 1];
  return name ? `${name} ${year}` : String(year);
}

/**
 * Joins one guardian's absent children into a single, locale-appropriate
 * list for the `{{student_names}}` placeholder — "Rahim, Karim and Ayesha"
 * in English, "Rahim, Karim ও Ayesha" in Bengali. Kept here, next to the
 * other template helpers, rather than a separate i18n module: this file is
 * already the one place both the fee and absence-notice paths import
 * formatting helpers from, and there is no other locale-aware joiner in the
 * codebase yet to share this with.
 */
export function joinStudentNames(names: string[], locale: string): string {
  if (names.length <= 1) return names[0] ?? '';
  const joiner = locale.startsWith('bn') ? ' ও ' : ' and ';
  return `${names.slice(0, -1).join(', ')}${joiner}${names[names.length - 1]}`;
}

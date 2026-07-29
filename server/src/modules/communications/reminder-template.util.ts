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
] as const;

export type SupportedPlaceholder = (typeof SUPPORTED_PLACEHOLDERS)[number];

export type ReminderTemplateVars = Record<SupportedPlaceholder, string>;

export function isSupportedPlaceholder(name: string): name is SupportedPlaceholder {
  return (SUPPORTED_PLACEHOLDERS as readonly string[]).includes(name);
}

/** Narrows an arbitrary placeholder name before indexing the vars. */
export function templateVarValue(vars: ReminderTemplateVars, name: string): string | undefined {
  return isSupportedPlaceholder(name) ? vars[name] : undefined;
}

// Tolerates inner padding (`{{ student_name }}`) because templates are typed
// by hand in an admin UI and a stray space shouldn't silently ship a literal
// `{{ student_name }}` to a guardian's phone.
const PLACEHOLDER_PATTERN = /\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g;

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
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
    if (!isSupportedPlaceholder(match[1])) {
      found.add(match[1]);
    }
  }
  return [...found];
}

export function renderReminderTemplate(template: string, vars: ReminderTemplateVars): string {
  return template.replace(PLACEHOLDER_PATTERN, (original: string, name: string) => {
    // Unsupported names are validated away before this runs; if one slips
    // through, leaving it verbatim is more diagnosable than an empty gap.
    return templateVarValue(vars, name) ?? original;
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

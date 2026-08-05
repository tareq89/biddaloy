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

// Captures anything between the braces — not just [a-zA-Z0-9_] — so a typo
// like `{{student-name}}` is still recognized as a placeholder attempt and
// validated (and rejected) rather than silently skipped by the pattern and
// shipped to a guardian's phone as literal text. Inner padding is trimmed
// separately so `{{ student_name }}` still resolves.
const PLACEHOLDER_PATTERN = /\{\{\s*([^{}]*?)\s*\}\}/g;

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

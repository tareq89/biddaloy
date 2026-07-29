import { describe, it, expect } from 'vitest';
import {
  renderReminderTemplate,
  findUnsupportedPlaceholders,
  isSupportedPlaceholder,
  templateVarValue,
  formatDueAmount,
  formatDueMonth,
  ReminderTemplateVars,
} from './reminder-template.util';

const VARS: ReminderTemplateVars = {
  student_name: 'Rahim Uddin',
  guardian_name: 'Karim Uddin',
  due_amount: '1,500.00',
  due_month: 'March 2026',
};

describe('renderReminderTemplate', () => {
  it('replaces every supported placeholder', () => {
    const result = renderReminderTemplate(
      'Dear {{guardian_name}}, {{student_name}} owes {{due_amount}} for {{due_month}}.',
      VARS,
    );

    expect(result).toBe('Dear Karim Uddin, Rahim Uddin owes 1,500.00 for March 2026.');
  });

  it('tolerates padding inside the braces', () => {
    expect(renderReminderTemplate('Hi {{  guardian_name  }}', VARS)).toBe('Hi Karim Uddin');
  });

  it('replaces every occurrence of a repeated placeholder', () => {
    expect(renderReminderTemplate('{{student_name}} / {{student_name}}', VARS)).toBe(
      'Rahim Uddin / Rahim Uddin',
    );
  });

  it('leaves an unsupported placeholder verbatim rather than blanking it', () => {
    // The service rejects these before rendering; if one ever reaches here,
    // a visible {{foo}} is easier to trace than a silent gap.
    expect(renderReminderTemplate('Hi {{foo}}', VARS)).toBe('Hi {{foo}}');
  });

  it('returns a template with no placeholders unchanged', () => {
    expect(renderReminderTemplate('Fees are due.', VARS)).toBe('Fees are due.');
  });

  it('does not treat single braces as placeholders', () => {
    expect(renderReminderTemplate('{student_name}', VARS)).toBe('{student_name}');
  });
});

describe('findUnsupportedPlaceholders', () => {
  it('returns an empty array when every placeholder is supported', () => {
    expect(findUnsupportedPlaceholders('{{student_name}} {{due_amount}}')).toEqual([]);
  });

  it('reports unsupported names', () => {
    expect(findUnsupportedPlaceholders('{{student}} owes {{amount}}')).toEqual(['student', 'amount']);
  });

  it('deduplicates a name used more than once', () => {
    expect(findUnsupportedPlaceholders('{{foo}} and {{foo}}')).toEqual(['foo']);
  });

  it('ignores supported names while collecting unsupported ones', () => {
    expect(findUnsupportedPlaceholders('{{student_name}} {{nope}}')).toEqual(['nope']);
  });
});

describe('isSupportedPlaceholder / templateVarValue', () => {
  it('recognises the four documented placeholders', () => {
    expect(isSupportedPlaceholder('student_name')).toBe(true);
    expect(isSupportedPlaceholder('guardian_name')).toBe(true);
    expect(isSupportedPlaceholder('due_amount')).toBe(true);
    expect(isSupportedPlaceholder('due_month')).toBe(true);
  });

  it('rejects anything else', () => {
    expect(isSupportedPlaceholder('constructor')).toBe(false);
    expect(isSupportedPlaceholder('')).toBe(false);
  });

  it('returns undefined for an unsupported name instead of leaking an object property', () => {
    expect(templateVarValue(VARS, 'toString')).toBeUndefined();
    expect(templateVarValue(VARS, 'due_month')).toBe('March 2026');
  });
});

describe('formatDueAmount', () => {
  it('groups thousands and always shows two decimals', () => {
    expect(formatDueAmount(1500)).toBe('1,500.00');
    expect(formatDueAmount(1234567.5)).toBe('1,234,567.50');
  });

  it('formats small and zero amounts', () => {
    expect(formatDueAmount(0)).toBe('0.00');
    expect(formatDueAmount(99.999)).toBe('100.00');
  });
});

describe('formatDueMonth', () => {
  it('renders a month name with the year', () => {
    expect(formatDueMonth(1, 2026)).toBe('January 2026');
    expect(formatDueMonth(12, 2025)).toBe('December 2025');
  });

  it('falls back to the year alone for an out-of-range month', () => {
    expect(formatDueMonth(0, 2026)).toBe('2026');
    expect(formatDueMonth(13, 2026)).toBe('2026');
  });
});

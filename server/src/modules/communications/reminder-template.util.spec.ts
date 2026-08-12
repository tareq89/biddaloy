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

// require(), not a static import — see sanitize-text.decorator.ts's comment on
// why a static `import { sanitizeStrict } from '@biddaloy/shared'` silently
// binds to undefined under this repo's vitest config.
const { sanitizeStrict } = require('@biddaloy/shared') as typeof import('@biddaloy/shared');

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

  it('leaves a hyphenated placeholder verbatim rather than passing it through unrecognized', () => {
    // {{student-name}} previously fell outside the word-char-only pattern
    // entirely, so it was neither flagged as unsupported nor rendered — it
    // just shipped to the guardian as literal "{{student-name}}".
    expect(renderReminderTemplate('Hi {{student-name}}', VARS)).toBe('Hi {{student-name}}');
  });

  it('leaves an empty placeholder verbatim', () => {
    expect(renderReminderTemplate('Hi {{}}', VARS)).toBe('Hi {{}}');
  });
});

describe('findUnsupportedPlaceholders', () => {
  it('returns an empty array when every placeholder is supported', () => {
    expect(findUnsupportedPlaceholders('{{student_name}} {{due_amount}}')).toEqual([]);
  });

  it('reports unsupported names', () => {
    expect(findUnsupportedPlaceholders('{{student}} owes {{amount}}')).toEqual([
      'student',
      'amount',
    ]);
  });

  it('deduplicates a name used more than once', () => {
    expect(findUnsupportedPlaceholders('{{foo}} and {{foo}}')).toEqual(['foo']);
  });

  it('ignores supported names while collecting unsupported ones', () => {
    expect(findUnsupportedPlaceholders('{{student_name}} {{nope}}')).toEqual(['nope']);
  });

  it('flags a hyphenated placeholder as unsupported', () => {
    expect(findUnsupportedPlaceholders('{{student-name}}')).toEqual(['student-name']);
  });

  it('flags an empty placeholder as unsupported', () => {
    expect(findUnsupportedPlaceholders('{{}}')).toEqual(['']);
  });

  it('trims padding before comparing against supported names', () => {
    expect(findUnsupportedPlaceholders('{{ student_name }}')).toEqual([]);
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

describe('renderReminderTemplate with a sanitized name (issue #33)', () => {
  // Student/Guardian full_name is sanitized at creation (@SanitizeText on
  // CreateStudentDto/CreateGuardianDto), so by the time it reaches here as
  // a template var it's already clean — this exercises that path end to
  // end rather than asserting sanitizeStrict and renderReminderTemplate
  // are each correct in isolation.
  it('interpolates a name that had a script payload stripped at creation', () => {
    const vars: ReminderTemplateVars = {
      student_name: sanitizeStrict('<script>alert(1)</script>Rahim Uddin'),
      guardian_name: 'Karim Uddin',
      due_amount: '1,500.00',
      due_month: 'March 2026',
    };

    expect(vars.student_name).toBe('Rahim Uddin');
    expect(
      renderReminderTemplate('Dear {{guardian_name}}, {{student_name}} owes {{due_amount}}.', vars),
    ).toBe('Dear Karim Uddin, Rahim Uddin owes 1,500.00.');
  });

  it('leaves placeholder syntax in the template untouched regardless of sanitization', () => {
    const vars: ReminderTemplateVars = {
      student_name: sanitizeStrict("O'Brien"),
      guardian_name: sanitizeStrict('Tom & Jerry'),
      due_amount: '500.00',
      due_month: 'April 2026',
    };

    expect(renderReminderTemplate('{{student_name}} / {{guardian_name}}', vars)).toBe(
      "O'Brien / Tom & Jerry",
    );
  });
});

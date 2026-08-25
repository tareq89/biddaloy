import { describe, expect, it } from 'vitest';

import { findUnsupportedPlaceholders } from './template-placeholders';

describe('findUnsupportedPlaceholders', () => {
  it('accepts a template using only the four supported tokens', () => {
    expect(
      findUnsupportedPlaceholders(
        'Dear {{guardian_name}}, {{student_name}} owes {{due_amount}} for {{due_month}}.',
      ),
    ).toEqual([]);
  });

  it('accepts inner whitespace padding, matching the server pattern', () => {
    // reminder-template.util.ts trims padding before checking the name —
    // `{{ guardian_name }}` renders fine server-side, so rejecting it
    // here would block a template the server accepts.
    expect(
      findUnsupportedPlaceholders('Dear {{ guardian_name }}, dues: {{  due_amount  }}.'),
    ).toEqual([]);
  });

  it('flags an unknown token and a typo of a supported one', () => {
    expect(findUnsupportedPlaceholders('Hi {{class_name}}, {{studnet_name}} owes.')).toEqual([
      '{{class_name}}',
      '{{studnet_name}}',
    ]);
  });

  it('normalizes a padded unknown token in its report', () => {
    expect(findUnsupportedPlaceholders('Hi {{ class_name }}')).toEqual(['{{class_name}}']);
  });

  it('deduplicates a repeated unknown token, padded or not', () => {
    expect(findUnsupportedPlaceholders('{{x}} and {{ x }}')).toEqual(['{{x}}']);
  });

  it('ignores single braces and plain text', () => {
    expect(findUnsupportedPlaceholders('Pay {50} now, {guardian_name}.')).toEqual([]);
  });
});

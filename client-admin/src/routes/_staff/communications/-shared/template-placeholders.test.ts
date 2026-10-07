import { describe, expect, it } from 'vitest';

import {
  findUnknownLabels,
  hasStrayBraces,
  findUnsupportedPlaceholders,
  toDisplayTemplate,
  toServerTemplate,
  type PlaceholderLabels,
} from './template-placeholders';

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

const BN_LABELS: PlaceholderLabels = {
  student_name: 'শিক্ষার্থীর নাম',
  guardian_name: 'অভিভাবকের নাম',
  due_amount: 'বকেয়ার পরিমাণ',
  due_month: 'বকেয়ার মাস',
};

describe('display and server conversion', () => {
  it('turns display words into server tokens', () => {
    expect(toServerTemplate('প্রিয় {অভিভাবকের নাম}', BN_LABELS)).toBe('প্রিয় {{guardian_name}}');
  });

  it('passes tokens typed directly through untouched', () => {
    expect(toServerTemplate('{{student_name}}', BN_LABELS)).toBe('{{student_name}}');
  });

  it('turns padded server tokens into display words', () => {
    expect(toDisplayTemplate('{{ due_amount }}', BN_LABELS)).toBe('{বকেয়ার পরিমাণ}');
  });

  it('leaves an unsupported server token alone', () => {
    expect(toDisplayTemplate('{{class_name}}', BN_LABELS)).toBe('{{class_name}}');
  });

  it('reports an unknown single-brace word', () => {
    expect(findUnknownLabels('{ভুল} {বকেয়ার মাস}', BN_LABELS)).toEqual(['ভুল']);
  });

  it('round-trips', () => {
    const display = 'প্রিয় {অভিভাবকের নাম}, {শিক্ষার্থীর নাম} এর {বকেয়ার পরিমাণ}।';
    expect(toDisplayTemplate(toServerTemplate(display, BN_LABELS), BN_LABELS)).toBe(display);
  });
});

describe('hasStrayBraces', () => {
  it.each(['{Student name', '{{student_name}', 'a } b', '{{x}} }'])('flags %s', (text) => {
    expect(hasStrayBraces(text, BN_LABELS)).toBe(true);
  });

  it.each(['', 'plain', '{অভিভাবকের নাম} {{due_month}}', '{ভুল}'])('accepts %s', (text) => {
    expect(hasStrayBraces(text, BN_LABELS)).toBe(false);
  });
});

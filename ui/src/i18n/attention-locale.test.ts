/**
 * [67.2.02] Guard: no alert rule, category, severity or role ships without
 * words in both locales, and the Bangla glossary (D17/D40) holds.
 */
import { ALERT_RULES, AlertCategory, AlertSeverity, UserRole } from '@biddaloy/shared';
import { describe, expect, it } from 'vitest';

import bn from './locales/bn/attention.json';
import en from './locales/en/attention.json';

const locales = { en, bn } as const;

/** Resolves a dotted key by nesting, like i18next's default `.` separator. */
function get(tree: unknown, dotted: string): unknown {
  return dotted.split('.').reduce<unknown>((node, part) => (node as never)?.[part], tree);
}

function text(tree: unknown, dotted: string): string {
  const value = get(tree, dotted);
  return typeof value === 'string' ? value : '';
}

describe.each(Object.entries(locales))('attention.json (%s)', (_name, tree) => {
  it.each(ALERT_RULES.map((r) => r.key))('rule %s has a name and help', (key) => {
    expect(text(tree, `rules.${key}.name`)).not.toBe('');
    expect(text(tree, `rules.${key}.help`)).not.toBe('');
  });

  it.each(Object.values(AlertCategory))('category %s has a label and a help line', (cat) => {
    expect(text(tree, `category.${cat}`)).not.toBe('');
    expect(text(tree, `account.categoryHelp.${cat}`)).not.toBe('');
  });

  it.each(Object.values(AlertSeverity))('severity %s has a label', (sev) => {
    expect(text(tree, `severity.${sev}`)).not.toBe('');
  });

  it.each(Object.values(UserRole))('role %s has a label', (role) => {
    expect(text(tree, `roles.${role}`)).not.toBe('');
  });
});

describe('Bangla glossary', () => {
  it.each(['নোটিফিকেশন', 'হাজিরা', 'ক্লাস'])('never uses %s', (word) => {
    expect(JSON.stringify(bn)).not.toContain(word);
  });
});

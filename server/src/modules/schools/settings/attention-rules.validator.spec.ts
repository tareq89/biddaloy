import { describe, it, expect } from 'vitest';
import type { ValidationArguments } from 'class-validator';
import { AttentionRulesConstraint } from './attention-rules.validator';

const c = new AttentionRulesConstraint();
const msg = (value: unknown) =>
  c.defaultMessage({ property: 'rules', value } as ValidationArguments);

describe('AttentionRulesConstraint [67.1.06]', () => {
  it('accepts a disableable rule switched off', () => {
    expect(c.validate({ 'class.starting': { enabled: false } })).toBe(true);
  });

  it('rejects a non-disableable rule switched off, naming the key', () => {
    const v = { 'system.backup_failed': { enabled: false } };
    expect(c.validate(v)).toBe(false);
    expect(msg(v)).toContain('rule system.backup_failed cannot be switched off');
  });

  it('accepts a non-disableable rule left on', () => {
    expect(c.validate({ 'system.backup_failed': { enabled: true } })).toBe(true);
  });

  it('rejects unknown keys, non-boolean enabled and extra properties', () => {
    expect(c.validate({ 'nope.rule': { enabled: true } })).toBe(false);
    expect(c.validate({ 'class.starting': { enabled: 'no' } })).toBe(false);
    expect(c.validate({ 'class.starting': { enabled: true, x: 1 } })).toBe(false);
    expect(c.validate([])).toBe(false);
  });
});

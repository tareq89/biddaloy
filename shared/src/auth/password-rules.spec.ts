import { describe, expect, it } from 'vitest';

import { UserRole } from '../enums/index';
import { audienceForRoles, checkPassword, passwordRulesFor } from './password-rules';

const failed = (p: string, a: 'staff' | 'family') =>
  checkPassword(p, a)
    .filter((r) => !r.ok)
    .map((r) => r.id);

describe('password rules', () => {
  it('lists rules per audience', () => {
    expect(passwordRulesFor('staff')).toEqual(['minLength', 'upper', 'lower', 'digit', 'special']);
    expect(passwordRulesFor('family')).toEqual(['minLength', 'digit']);
  });

  it('checks each rule true and false', () => {
    expect(failed('Abc@1234', 'staff')).toEqual([]);
    expect(failed('Abc@123', 'staff')).toEqual(['minLength']);
    expect(failed('abc@1234', 'staff')).toEqual(['upper']);
    expect(failed('ABC@1234', 'staff')).toEqual(['lower']);
    expect(failed('Abc@defg', 'staff')).toEqual(['digit']);
    expect(failed('Abcd1234', 'staff')).toEqual(['special']);
  });

  it('family accepts abcd1234; staff fails upper + special', () => {
    expect(failed('abcd1234', 'family')).toEqual([]);
    expect(failed('abcd1234', 'staff')).toEqual(['upper', 'special']);
  });

  it('counts Bangla digits as digits, not as special', () => {
    expect(failed('abcdefg১', 'family')).toEqual([]);
    expect(failed('Abc@defg১', 'staff')).toEqual([]);
    expect(failed('Abcdefg১', 'staff')).toEqual(['special']);
  });

  it('a Bangla letter is a letter, not a symbol', () => {
    expect(failed('Abcdefg1ক', 'staff')).toEqual(['special']);
  });

  it('Bangla vowel signs and the virama are part of a word, not symbols', () => {
    expect(failed('Abcdefg1কি', 'staff')).toEqual(['special']);
    expect(failed('Abcdefg1ক্ষ', 'staff')).toEqual(['special']);
  });

  it('audienceForRoles: strictest wins', () => {
    expect(audienceForRoles([UserRole.PARENT, UserRole.STUDENT])).toBe('family');
    expect(audienceForRoles([UserRole.PARENT, UserRole.TEACHER])).toBe('staff');
    expect(audienceForRoles([])).toBe('staff');
  });
});

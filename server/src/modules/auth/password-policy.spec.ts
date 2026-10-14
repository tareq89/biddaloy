import { describe, it, expect } from 'vitest';
import { UserRole } from '@biddaloy/shared';
import { assertPasswordAllowed } from './password-policy';

function tooLongCode(password: string): string | undefined {
  try {
    assertPasswordAllowed(password, [UserRole.PARENT]);
    return undefined;
  } catch (error) {
    return (error as { getResponse: () => { details: { code: string } } }).getResponse().details
      .code;
  }
}

function failedRules(password: string, roles: UserRole[]): string[] {
  try {
    assertPasswordAllowed(password, roles);
    return [];
  } catch (error) {
    const response = (
      error as { getResponse: () => { details: { failed: string[] } } }
    ).getResponse();
    return response.details.failed;
  }
}

describe('assertPasswordAllowed (D10)', () => {
  it('a TEACHER needs all five rules', () => {
    expect(failedRules('password', [UserRole.TEACHER])).toEqual(['upper', 'digit', 'special']);
    expect(failedRules('Str0ng-pass', [UserRole.TEACHER])).toEqual([]);
  });

  it('a PARENT needs only 8 characters and a digit', () => {
    expect(failedRules('password', [UserRole.PARENT])).toEqual(['digit']);
    expect(failedRules('simple123', [UserRole.PARENT])).toEqual([]);
  });

  it('PARENT + TEACHER, or no membership at all, gets the staff rules', () => {
    expect(failedRules('simple123', [UserRole.PARENT, UserRole.TEACHER])).not.toEqual([]);
    expect(failedRules('simple123', [])).not.toEqual([]);
  });

  it('reports PASSWORD_TOO_WEAK as a 400 with details.code', () => {
    try {
      assertPasswordAllowed('x', [UserRole.PARENT]);
      expect.unreachable();
    } catch (error) {
      expect((error as { getStatus: () => number }).getStatus()).toBe(400);
      expect(
        (error as { getResponse: () => { details: { code: string } } }).getResponse().details.code,
      ).toBe('PASSWORD_TOO_WEAK');
    }
  });

  // bcrypt ignores bytes past 72, so a longer NEW password is refused (never at sign-in).
  it('accepts a 72-byte password and refuses 73 bytes', () => {
    expect(tooLongCode('a1' + 'x'.repeat(70))).toBeUndefined();
    expect(tooLongCode('a1' + 'x'.repeat(71))).toBe('PASSWORD_TOO_LONG');
  });

  it('counts bytes, not characters: 24 Bangla letters (72 bytes) pass, 25 fail', () => {
    expect(tooLongCode('ক'.repeat(24) + '')).not.toBe('PASSWORD_TOO_LONG');
    expect(tooLongCode('ক'.repeat(25))).toBe('PASSWORD_TOO_LONG');
  });
});

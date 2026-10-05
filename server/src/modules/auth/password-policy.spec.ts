import { describe, it, expect } from 'vitest';
import { UserRole } from '@biddaloy/shared';
import { assertPasswordAllowed } from './password-policy';

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
});

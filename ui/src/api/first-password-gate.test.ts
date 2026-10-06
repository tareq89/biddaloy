import { UserRole } from '@biddaloy/shared';
import { afterEach, describe, expect, it } from 'vitest';

import { cleanupTestState } from '../test';

import { setAccessToken } from './auth-state';
import {
  clearFirstPasswordGate,
  getFirstPasswordGate,
  requireFirstPassword,
} from './first-password-gate';

/** `decodeAccessTokenSubject` never checks a signature. */
function tokenFor(sub: string): string {
  return `header.${btoa(JSON.stringify({ sub }))}.signature`;
}

afterEach(async () => {
  clearFirstPasswordGate();
  await cleanupTestState();
});

describe('first-password gate', () => {
  it('holds for the account that owes the password', () => {
    setAccessToken(tokenFor('user-a'));
    requireFirstPassword([UserRole.TEACHER]);
    expect(getFirstPasswordGate()).toEqual([UserRole.TEACHER]);
  });

  it('is ignored, and dropped, once another account is signed in', () => {
    setAccessToken(tokenFor('user-a'));
    requireFirstPassword([UserRole.TEACHER]);

    setAccessToken(tokenFor('user-b'));
    expect(getFirstPasswordGate()).toBeNull();

    setAccessToken(tokenFor('user-a'));
    expect(getFirstPasswordGate()).toBeNull();
  });

  it('does not gate with no session', () => {
    setAccessToken(tokenFor('user-a'));
    requireFirstPassword([UserRole.TEACHER]);
    setAccessToken(null);
    expect(getFirstPasswordGate()).toBeNull();
  });
});

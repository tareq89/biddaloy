import { describe, expect, it } from 'vitest';

import { needsSupportWelcome } from './first-login-gate';

const confirmed = { confirmedAt: '2026-11-01T00:00:00Z', textVersion: 1, currentTextVersion: 1 };

describe('needsSupportWelcome', () => {
  it('sends an unconfirmed admin', () => {
    expect(
      needsSupportWelcome({
        role: 'ADMIN',
        supportSession: false,
        settings: { ...confirmed, confirmedAt: null },
      }),
    ).toBe(true);
  });

  it('does not send a confirmed admin', () => {
    expect(needsSupportWelcome({ role: 'ADMIN', supportSession: false, settings: confirmed })).toBe(
      false,
    );
  });

  it('sends an admin who confirmed an older text', () => {
    expect(
      needsSupportWelcome({
        role: 'ADMIN',
        supportSession: false,
        settings: { ...confirmed, currentTextVersion: 2 },
      }),
    ).toBe(true);
  });

  it('never sends a non-admin', () => {
    for (const role of ['TEACHER', 'ACCOUNTANT', 'EXECUTIVE', 'PARENT', null]) {
      expect(
        needsSupportWelcome({
          role,
          supportSession: false,
          settings: { ...confirmed, confirmedAt: null },
        }),
      ).toBe(false);
    }
  });

  it('never sends a Login as tab', () => {
    expect(
      needsSupportWelcome({
        role: 'ADMIN',
        supportSession: true,
        settings: { ...confirmed, confirmedAt: null },
      }),
    ).toBe(false);
  });
});

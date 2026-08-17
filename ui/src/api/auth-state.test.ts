import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  clearAuthState,
  notifySessionExpired,
  registerSessionExpiredHandler,
  setAccessToken,
  setActiveRole,
  setActiveTenant,
} from './auth-state';

/**
 * [8.9.3]'s AC: "the access token is never written to localStorage or
 * sessionStorage — asserted by test." `auth-state.ts` already only ever
 * assigns to a plain module-scoped variable, but that's exactly the kind
 * of fact a later refactor could silently break without anything failing
 * — this is the regression test that would catch it.
 */
describe('auth-state never touches localStorage or sessionStorage', () => {
  let localStorageSpy: ReturnType<typeof vi.spyOn>;
  let sessionStorageSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    localStorageSpy = vi.spyOn(Storage.prototype, 'setItem');
    sessionStorageSpy = vi.spyOn(window.sessionStorage, 'setItem');
  });

  afterEach(() => {
    clearAuthState();
    registerSessionExpiredHandler(null);
    localStorageSpy.mockRestore();
    sessionStorageSpy.mockRestore();
  });

  it('setAccessToken never reaches either storage', () => {
    setAccessToken('super-secret-token');

    expect(localStorageSpy).not.toHaveBeenCalled();
    expect(sessionStorageSpy).not.toHaveBeenCalled();
  });

  it('setActiveTenant/setActiveRole never reach either storage', () => {
    setActiveTenant('tenant-1');
    setActiveRole('ADMIN');

    expect(localStorageSpy).not.toHaveBeenCalled();
    expect(sessionStorageSpy).not.toHaveBeenCalled();
  });

  it('clearAuthState and notifySessionExpired never reach either storage', () => {
    setAccessToken('super-secret-token');
    registerSessionExpiredHandler(() => {});

    clearAuthState();
    notifySessionExpired();

    expect(localStorageSpy).not.toHaveBeenCalled();
    expect(sessionStorageSpy).not.toHaveBeenCalled();
  });
});

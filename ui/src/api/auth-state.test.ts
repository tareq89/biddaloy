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
 * assigns the token to a plain module-scoped variable, but that's exactly
 * the kind of fact a later refactor could silently break without anything
 * failing — this is the regression test that would catch it.
 *
 * [8.9.5] adds one deliberate, narrower exception: `clearAuthState()` now
 * also clears the *persisted active tenant* (`tenant-storage.ts`, a UUID
 * hint, never a credential) via `localStorage.removeItem` — see that
 * module's own comment. These tests still assert no code path here ever
 * *writes* anything to storage (`setItem`), which is the actual security
 * property; the last test below explicitly also confirms the expected
 * `removeItem` cleanup, so a future refactor that turned that removal into
 * a write would still fail loudly here.
 */
describe('auth-state never writes to localStorage or sessionStorage', () => {
  let localStorageSpy: ReturnType<typeof vi.spyOn>;
  let sessionStorageSpy: ReturnType<typeof vi.spyOn>;
  let localStorageRemoveSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    localStorageSpy = vi.spyOn(Storage.prototype, 'setItem');
    sessionStorageSpy = vi.spyOn(window.sessionStorage, 'setItem');
    localStorageRemoveSpy = vi.spyOn(Storage.prototype, 'removeItem');
  });

  afterEach(() => {
    clearAuthState();
    registerSessionExpiredHandler(null);
    localStorageSpy.mockRestore();
    sessionStorageSpy.mockRestore();
    localStorageRemoveSpy.mockRestore();
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

  it('clearAuthState and notifySessionExpired never write to either storage', () => {
    setAccessToken('super-secret-token');
    registerSessionExpiredHandler(() => {});

    clearAuthState();
    notifySessionExpired();

    expect(localStorageSpy).not.toHaveBeenCalled();
    expect(sessionStorageSpy).not.toHaveBeenCalled();
  });

  it('clearAuthState clears the persisted active tenant, via removeItem never setItem', () => {
    clearAuthState();

    expect(localStorageRemoveSpy).toHaveBeenCalledWith('biddaloy:activeTenant');
    expect(localStorageSpy).not.toHaveBeenCalled();
  });
});

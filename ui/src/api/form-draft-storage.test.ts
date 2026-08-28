import { afterEach, describe, expect, it, vi } from 'vitest';

import { clearAuthState, setActiveTenant, getActiveTenant } from './auth-state';
import { clearAllFormDrafts, FORM_DRAFT_KEY_PREFIX, formDraftKey } from './form-draft-storage';

afterEach(() => {
  vi.restoreAllMocks();
  clearAuthState();
  window.localStorage.clear();
});

describe('formDraftKey', () => {
  it('gives the same form a different key under each tenant', () => {
    setActiveTenant('tenant-a');
    const underA = formDraftKey('student-new', getActiveTenant());
    setActiveTenant('tenant-b');
    const underB = formDraftKey('student-new', getActiveTenant());

    // The bug this fixes: an administrator of two schools was offered
    // school A's abandoned draft while filling in the same form at
    // school B, with nothing on screen saying so.
    expect(underA).not.toBe(underB);
    expect(underA.startsWith(FORM_DRAFT_KEY_PREFIX)).toBe(true);
  });

  it('keeps different forms under the same tenant apart', () => {
    setActiveTenant('tenant-a');

    expect(formDraftKey('student-new', getActiveTenant())).not.toBe(
      formDraftKey('guardian-new', getActiveTenant()),
    );
  });

  it('does not collapse to the unscoped key before a tenant is chosen', () => {
    clearAuthState();

    expect(formDraftKey('student-new', getActiveTenant())).toBe(
      `${FORM_DRAFT_KEY_PREFIX}no-tenant:student-new`,
    );
  });
});

describe('clearAllFormDrafts', () => {
  it('removes drafts from every tenant and leaves everything else alone', () => {
    setActiveTenant('tenant-a');
    window.localStorage.setItem(formDraftKey('student-new', getActiveTenant()), '{}');
    window.localStorage.setItem(formDraftKey('guardian-new', getActiveTenant()), '{}');
    setActiveTenant('tenant-b');
    window.localStorage.setItem(formDraftKey('student-new', getActiveTenant()), '{}');
    window.localStorage.setItem('biddaloy.locale', 'bn');

    clearAllFormDrafts();

    expect(
      Object.keys(window.localStorage).filter((k) => k.startsWith(FORM_DRAFT_KEY_PREFIX)),
    ).toEqual([]);
    expect(window.localStorage.getItem('biddaloy.locale')).toBe('bn');
  });

  it('removes every draft, not every other one', () => {
    setActiveTenant('tenant-a');
    for (let i = 0; i < 6; i += 1) {
      window.localStorage.setItem(formDraftKey(`form-${i}`, getActiveTenant()), '{}');
    }

    clearAllFormDrafts();

    // Removing while walking `localStorage.key(i)` shifts the remaining
    // indices down and silently skips half of them — this is the
    // regression test for that specific mistake.
    expect(window.localStorage.length).toBe(0);
  });

  it('stays silent when storage is unavailable', () => {
    vi.spyOn(Storage.prototype, 'key').mockImplementation(() => {
      throw new Error('storage disabled');
    });
    window.localStorage.setItem('x', 'y');

    expect(() => clearAllFormDrafts()).not.toThrow();
  });
});

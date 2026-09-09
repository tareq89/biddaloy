import { afterEach, describe, expect, it } from 'vitest';

import { dismissPushOptIn, isPushOptInDismissed } from './push-opt-in-dismissal';

describe('push-opt-in-dismissal', () => {
  afterEach(() => {
    window.localStorage.clear();
  });

  it('is not dismissed by default', () => {
    expect(isPushOptInDismissed('user-1')).toBe(false);
  });

  it('scopes dismissal to the dismissing user', () => {
    dismissPushOptIn('user-1');

    expect(isPushOptInDismissed('user-1')).toBe(true);
    // A different guardian on the same browser must still see the prompt.
    expect(isPushOptInDismissed('user-2')).toBe(false);
  });
});

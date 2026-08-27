import { describe, it, expect } from 'vitest';

import bn from '../../../../../../ui/src/i18n/locales/bn/communications.json';
import en from '../../../../../../ui/src/i18n/locales/en/communications.json';

import { skipReasonKey } from './skip-reason';

// The server's SkipReason wire values (server/src/modules/communications/
// reminders.service.ts). A value with no mapping renders as the raw
// snake_case string in the "Why skipped" column, in both languages. [5.4c]
const SERVER_SKIP_REASONS = [
  'no_open_dues',
  'no_guardians',
  'preferred_medium_not_in_requested_mediums',
  'preferred_medium_has_no_automated_provider',
  'guardian_has_no_address_for_preferred_medium',
  'guardian_notifications_disabled',
];

describe('skipReasonKey', () => {
  it.each(SERVER_SKIP_REASONS)('maps %s to an i18n key present in en and bn', (reason) => {
    const key = skipReasonKey(reason);
    expect(key).toBe(`skipReasons.${reason}`);

    const en_value = (en.skipReasons as Record<string, string>)[reason];
    const bn_value = (bn.skipReasons as Record<string, string>)[reason];
    expect(en_value).toBeTruthy();
    expect(bn_value).toBeTruthy();
    expect(bn_value).not.toBe(en_value);
  });

  it('returns undefined for a reason this UI predates, so the caller can fall back', () => {
    expect(skipReasonKey('some_future_reason')).toBeUndefined();
  });
});

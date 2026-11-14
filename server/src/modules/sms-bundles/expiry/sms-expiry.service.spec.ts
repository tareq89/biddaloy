import { describe, it, expect } from 'vitest';
import { addDays, smsExpiryNoticeFor } from './sms-expiry.service';

describe('smsExpiryNoticeFor', () => {
  it('only exactly 7 and 1 days ahead get a notice', () => {
    expect(smsExpiryNoticeFor(7)).toBe('sms_expiring_d7');
    expect(smsExpiryNoticeFor(1)).toBe('sms_expiring_d1');
    for (const d of [-1, 0, 2, 6, 8, 30]) expect(smsExpiryNoticeFor(d)).toBeNull();
  });
});

describe('addDays', () => {
  it('adds calendar days across a month end', () => {
    expect(addDays('2027-02-25', 7)).toBe('2027-03-04');
    expect(addDays('2027-03-10', 1)).toBe('2027-03-11');
  });
});

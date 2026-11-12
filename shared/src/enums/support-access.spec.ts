import { describe, expect, it } from 'vitest';
import {
  ImpersonationEndedBy,
  ImpersonationEntryKind,
  ImpersonationStatus,
  SupportAccessMode,
} from './support-access';

describe('support-access enums', () => {
  it('pin the value lists', () => {
    expect(Object.values(ImpersonationStatus)).toEqual([
      'REQUESTED',
      'APPROVED',
      'ACTIVE',
      'ENDED',
      'EXPIRED',
      'DENIED',
    ]);
    expect(Object.values(SupportAccessMode)).toEqual(['allowed', 'ask', 'blocked']);
    expect(Object.values(ImpersonationEntryKind)).toEqual(['NORMAL', 'EMERGENCY']);
    expect(Object.values(ImpersonationEndedBy)).toEqual([
      'OWNER',
      'PERSON_TAB',
      'SCHOOL_ADMIN',
      'REPLACED',
      'EXPIRED',
      'MODE_BLOCKED',
      'LOCKED',
    ]);
  });
});

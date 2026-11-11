import { describe, expect, it } from 'vitest';
import type { School } from '../modules/schools/entities/school.entity';
import { ensureSupportAccessConfirmed } from './seed.support-access';

describe('ensureSupportAccessConfirmed [99.1.05]', () => {
  it('sets a confirmation once; a second call changes nothing', () => {
    const school = { settings: { attendance: { x: 1 } } } as unknown as School;

    expect(ensureSupportAccessConfirmed(school)).toBe(true);
    const first = school.settings!.supportAccess!;
    expect(first.mode).toBe('allowed');
    expect(first.confirmedAt).toEqual(expect.any(String));
    expect(first.textVersion).toBe(1);
    expect((school.settings as Record<string, unknown>).attendance).toEqual({ x: 1 });

    expect(ensureSupportAccessConfirmed(school)).toBe(false);
    expect(school.settings!.supportAccess).toBe(first);
  });

  it('works on a school with no settings', () => {
    const school = { settings: null } as unknown as School;
    expect(ensureSupportAccessConfirmed(school)).toBe(true);
    expect(school.settings!.supportAccess!.confirmedAt).toEqual(expect.any(String));
  });

  it('keeps a hand-set value', () => {
    const hand = {
      mode: 'blocked',
      confirmedAt: '2026-01-01T00:00:00.000Z',
      confirmedBy: 'u',
      textVersion: 1,
    };
    const school = { settings: { supportAccess: hand } } as unknown as School;
    expect(ensureSupportAccessConfirmed(school)).toBe(false);
    expect(school.settings!.supportAccess).toEqual(hand);
  });
});

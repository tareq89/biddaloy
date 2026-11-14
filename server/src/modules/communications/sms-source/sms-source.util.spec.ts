import { describe, it, expect } from 'vitest';
import { readSmsSource, withSmsSource } from './sms-source.util';

const own = { mimsms: { apiKey: 'enc:k', senderId: 'S1' } };

describe('readSmsSource', () => {
  it('reads an explicit value', () => {
    expect(readSmsSource({ communications: { sms: { source: 'SCHOOLMANAGERP' } } })).toBe(
      'SCHOOLMANAGERP',
    );
    // explicit OWN wins over a PLATFORM metering left behind
    expect(
      readSmsSource({ communications: { sms: { source: 'OWN', metering: 'PLATFORM' } } }),
    ).toBe('OWN');
  });

  it('derives from metering when source is absent', () => {
    expect(readSmsSource({ communications: { sms: { metering: 'PLATFORM' } } })).toBe(
      'SCHOOLMANAGERP',
    );
    expect(readSmsSource({ communications: { sms: { metering: 'OFF' } } })).toBe('OWN');
    expect(readSmsSource({})).toBe('OWN');
    expect(readSmsSource(null)).toBe('OWN');
  });

  it('reads a garbage value as derived', () => {
    expect(
      readSmsSource({ communications: { sms: { source: 'nope', metering: 'PLATFORM' } } }),
    ).toBe('SCHOOLMANAGERP');
    expect(readSmsSource({ communications: { sms: { source: 7 } } })).toBe('OWN');
  });
});

describe('withSmsSource', () => {
  it('sets source and metering together and keeps every block', () => {
    const base = { version: 1, communications: { sms: { provider: 'mimsms', ...own } } };
    const away = withSmsSource(base, 'SCHOOLMANAGERP') as typeof base;
    expect(away.communications.sms).toMatchObject({
      source: 'SCHOOLMANAGERP',
      metering: 'PLATFORM',
      provider: 'mimsms',
      mimsms: own.mimsms,
    });
    const back = withSmsSource(away, 'OWN') as typeof base;
    expect(back.communications.sms).toMatchObject({ source: 'OWN', metering: 'OFF', ...own });
  });

  it('does not mutate its input and keeps other settings', () => {
    const base = { version: 1, region: { x: 1 }, communications: { email: { a: 1 } } };
    const out = withSmsSource(base, 'OWN') as Record<string, any>;
    expect(base.communications).toEqual({ email: { a: 1 } });
    expect(out.region).toEqual({ x: 1 });
    expect(out.communications.email).toEqual({ a: 1 });
  });
});

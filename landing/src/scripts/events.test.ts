import { describe, expect, it } from 'vitest';
import { parseConsent, withChat } from './events';

describe('consent state', () => {
  it('nothing or junk stored = essential only', () => {
    expect(parseConsent(null)).toBeNull();
    expect(parseConsent('nope')).toBeNull();
    expect(parseConsent('5')).toBeNull();
  });
  it('reads the three flags', () => {
    expect(parseConsent('{"stat":1,"ads":0,"chat":1}')).toEqual({ stat: 1, ads: 0, chat: 1 });
  });
  it('opening chat grants chat only and keeps the rest', () => {
    expect(withChat(null)).toEqual({ stat: 0, ads: 0, chat: 1 });
    expect(withChat('{"stat":1,"ads":0,"chat":0}')).toEqual({ stat: 1, ads: 0, chat: 1 });
  });
});

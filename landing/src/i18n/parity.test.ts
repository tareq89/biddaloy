import { describe, expect, it } from 'vitest';
import bn from './bn.json';
import en from './en.json';

describe('i18n parity', () => {
  it('bn and en have the same keys', () => {
    expect(Object.keys(en).sort()).toEqual(Object.keys(bn).sort());
  });
  it('no empty strings', () => {
    for (const [name, d] of [['bn', bn], ['en', en]] as const) {
      for (const [k, v] of Object.entries(d)) expect(v.trim(), `${name}:${k}`).not.toBe('');
    }
  });
});

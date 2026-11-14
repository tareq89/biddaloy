import { describe, it, expect } from 'vitest';
import { buildActionLines } from './sms-action-lines';

const base = {
  balance: { sms: 10_000, stale: false },
  promisedUnusedSms: 100,
  unsoldSms: 5,
  schoolsLow: 0,
  expiringSms: 0,
};

describe('buildActionLines', () => {
  it('says nothing when all is well', () => {
    expect(buildActionLines(base)).toEqual([]);
  });

  it('puts danger before warning, at most four lines', () => {
    const lines = buildActionLines({
      balance: { sms: 5, stale: false },
      promisedUnusedSms: 100,
      unsoldSms: -3,
      schoolsLow: 2,
      expiringSms: 40,
    });
    expect(lines.map((l) => [l.code, l.tone])).toEqual([
      ['TOP_UP_NOW', 'danger'],
      ['OVERSOLD', 'danger'],
      ['SCHOOLS_LOW', 'warning'],
      ['SMS_EXPIRING', 'warning'],
    ]);
  });

  it('a stale or unknown balance is a warning only, never danger', () => {
    for (const balance of [
      { sms: 10_000, stale: true },
      { sms: null, stale: false },
    ]) {
      const lines = buildActionLines({ ...base, balance });
      expect(lines.map((l) => [l.code, l.tone])).toEqual([['TOP_UP_NOW', 'warning']]);
    }
  });

  it('threshold: balance equal to promised is not short', () => {
    expect(buildActionLines({ ...base, balance: { sms: 100, stale: false } })).toEqual([]);
  });
});

/** [80.2.01] Staff message words: en/bn key parity and the Epic 80 glossary ("never say" terms). */
import { describe, expect, it } from 'vitest';

import bn from './locales/bn/communications.json';
import en from './locales/en/communications.json';

function flat(o: unknown, pre = ''): Record<string, string> {
  return Object.entries(o as Record<string, unknown>).reduce<Record<string, string>>(
    (acc, [k, v]) =>
      typeof v === 'object' && v !== null
        ? { ...acc, ...flat(v, `${pre}${k}.`) }
        : { ...acc, [`${pre}${k}`]: String(v) },
    {},
  );
}

const staffKeys = (t: unknown) => {
  const root = t as { staffMessage: unknown; help: unknown; fields: unknown };
  return {
    ...flat(root.staffMessage, 'staffMessage.'),
    ...Object.fromEntries(
      Object.entries(flat(root.help, 'help.')).filter(([k]) => k.startsWith('help.staff')),
    ),
    ...Object.fromEntries(
      Object.entries(flat(root.fields, 'fields.')).filter(([k]) => k.startsWith('fields.staff')),
    ),
  };
};

describe('staff message locale', () => {
  it('en and bn have the same keys', () => {
    expect(Object.keys(staffKeys(bn)).sort()).toEqual(Object.keys(staffKeys(en)).sort());
  });

  it('never says a glossary "never say" term', () => {
    const enText = Object.values(staffKeys(en)).join('\n').toLowerCase();
    for (const w of [
      'recipient',
      'audience',
      'payload',
      'segment',
      'ledger',
      'batch',
      'duplicate key',
    ]) {
      expect(enText).not.toContain(w);
    }
    const bnText = Object.values(staffKeys(bn)).join('\n');
    for (const w of ['প্রাপক', 'অডিয়েন্স', 'পেলোড', 'সেগমেন্ট', 'লেজার', 'ব্যাচ']) {
      expect(bnText).not.toContain(w);
    }
  });
});

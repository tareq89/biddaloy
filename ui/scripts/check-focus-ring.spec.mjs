// Coverage for the gate's *rules*, not just for "does the repo pass
// today" — mirrors `check-raw-palette.spec.mjs`'s reasoning. A check
// whose only test is the repo itself cannot tell a working rule apart
// from one that matches nothing, and the one case that matters most
// here — `aria-invalid:ring-3` must survive untouched — is exactly the
// kind of false positive an over-eager find-and-replace would introduce
// without anyone noticing until this spec broke.
import { describe, expect, it } from 'vitest';

import { scanFile } from './check-focus-ring.mjs';

const scan = (source) => scanFile('fixture.tsx', source);
const messages = (source) => scan(source).join('\n');

describe('deleted focus-ring vocabularies', () => {
  it('flags the brand-on-brand ring-ring/50', () => {
    expect(messages('<input className="focus-visible:ring-ring/50" />')).toContain('ring-ring/50');
  });

  it('flags focus-visible:border-ring', () => {
    expect(messages('<input className="focus-visible:border-ring" />')).toContain(
      'focus-visible:border-ring',
    );
  });

  it('flags focus-visible:outline-ring', () => {
    expect(messages('<a className="focus-visible:outline-ring" />')).toContain(
      'focus-visible:outline-ring',
    );
  });

  it('flags a bare outline-ring with no focus-visible prefix', () => {
    expect(messages('<a className="outline-ring" />')).toContain('outline-ring');
  });

  it('flags the arbitrary-value ring-[3px], not the same as ring-3', () => {
    expect(messages('<input className="focus-visible:ring-[3px]" />')).toContain(
      'focus-visible:ring-[3px]',
    );
  });

  it('flags focus-visible:ring-3', () => {
    expect(
      messages('<button className="focus-visible:ring-3 focus-visible:ring-ring/50" />'),
    ).toContain('focus-visible:ring-3');
  });

  it('does not flag aria-invalid:ring-3 — a different, intentional concern', () => {
    expect(
      scan('<input className="aria-invalid:ring-3 aria-invalid:ring-destructive/20" />'),
    ).toEqual([]);
  });

  it('does not flag the canonical string itself', () => {
    expect(
      scan(
        '<button className="outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background" />',
      ),
    ).toEqual([]);
  });

  it('does not flag the date-picker deviation (ring-offset-popover + z-10)', () => {
    expect(
      scan(
        '<button className="outline-none focus-visible:relative focus-visible:z-10 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-popover" />',
      ),
    ).toEqual([]);
  });

  it('does not flag the skip-link no-offset deviation', () => {
    expect(
      scan(
        '<a className="focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none" />',
      ),
    ).toEqual([]);
  });

  it('ignores a banned spelling mentioned only in a line comment', () => {
    expect(scan('// old pattern was focus-visible:border-ring, do not use it\n<input />')).toEqual(
      [],
    );
  });

  it('ignores a banned spelling mentioned only in a block comment', () => {
    expect(
      scan('/* focus-visible:ring-ring/50 was the old brand-on-brand ring */\n<input />'),
    ).toEqual([]);
  });
});

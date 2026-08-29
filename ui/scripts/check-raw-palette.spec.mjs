// Coverage for the gate's *rules*, not just for "does the repo pass today".
//
// A check whose only test is the repo itself cannot distinguish a rule that
// works from a rule that matches nothing — which is how three separate holes
// survived in this file: an arbitrary shadow value that neither shadow rule
// nor the colour rule looked at, a `drop-shadow-*` ban with no legal
// replacement to move to, and a raw line scan that flagged English prose in
// comments. Each of those has a negative test below as well as a positive one.
import { describe, expect, it } from 'vitest';

import { scanFile, stripComments } from './check-raw-palette.mjs';

const scan = (source) => scanFile('fixture.tsx', source);
const messages = (source) => scan(source).join('\n');

// Concatenated so the gate cannot flag its own fixtures when it scans `ui/src`
// (it does not scan `ui/scripts`, but the habit keeps the fixtures portable).
const raw = (name) => `shadow-${name}`;

describe('raw Tailwind palette scale', () => {
  it('flags a default hue on a bare utility', () => {
    expect(messages('<div className="bg-zinc-900" />')).toContain('bg-zinc-900');
  });

  it('flags a default hue behind variant prefixes', () => {
    expect(messages('<div className="dark:hover:text-blue-500" />')).toContain('text-blue-500');
  });

  it('flags a default hue on a directional/offset segment', () => {
    expect(messages('<div className="border-t-slate-200 ring-offset-red-500" />')).toContain(
      'border-t-slate-200',
    );
  });

  it('does not flag the preset-defined scales', () => {
    expect(scan('<div className="text-neutral-600 bg-brand-50 border-border-subtle" />')).toEqual(
      [],
    );
  });

  it('does not flag fixed physical values like the dialog scrim', () => {
    expect(scan('<div className="bg-black/50 text-white" />')).toEqual([]);
  });
});

describe('arbitrary colour values', () => {
  it('flags a hex literal', () => {
    expect(messages('<div className="bg-[#f8fafc]" />')).toContain('hard-codes a literal colour');
  });

  it('does not flag a non-colour arbitrary value', () => {
    expect(scan('<div className="from-[35%] outline-[3px]" />')).toEqual([]);
  });
});

describe('raw Tailwind shadow scale', () => {
  for (const size of ['2xs', 'xs', 'sm', 'md', 'lg', 'xl', '2xl', 'inner']) {
    it(`flags shadow-${size}`, () => {
      expect(messages(`<div className="${raw(size)}" />`)).toContain(
        'uses the raw Tailwind shadow scale',
      );
    });
  }

  it('flags a raw shadow behind a variant prefix', () => {
    expect(messages(`<div className="focus-visible:${raw('lg')}" />`)).toContain(
      'uses the raw Tailwind shadow scale',
    );
  });

  it('does not flag the elevation tokens or shadow-none', () => {
    expect(scan('<div className="shadow-e1 shadow-e2 shadow-e3 shadow-none" />')).toEqual([]);
  });

  // The ban was removed because there is no `--drop-shadow-e*` token, so
  // `drop-shadow-md` had no green spelling to move to. If a themed
  // drop-shadow scale is ever added, this expectation is the one to flip.
  it('does not flag drop-shadow-*, which has no token replacement', () => {
    expect(scan(`<div className="drop-${raw('md')}" />`)).toEqual([]);
  });
});

describe('arbitrary shadow values', () => {
  it('flags an inlined box-shadow value that names no size keyword', () => {
    const source = '<div className="shadow-[0_1px_2px_rgb(0_0_0/0.1)]" />';
    expect(messages(source)).toContain('hard-codes a literal shadow');
  });

  it('flags it behind a variant prefix too', () => {
    expect(messages('<div className="dark:shadow-[0_0_0_1px_black]" />')).toContain(
      'hard-codes a literal shadow',
    );
  });

  it('allows a bracket holding only a var() reference — that is the token system', () => {
    expect(scan('<div className="shadow-[var(--elevation-e1)]" />')).toEqual([]);
  });

  it('flags a var() reference with a literal shadow appended after it', () => {
    const source = '<div className="shadow-[var(--elevation-e1),0_1px_2px_rgb(0_0_0/0.1)]" />';
    expect(messages(source)).toContain('hard-codes a literal shadow');
  });

  it('reports a bracketed pure colour once, as a colour, not twice', () => {
    const errors = scan('<div className="shadow-[#000000]" />');
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain('hard-codes a literal colour');
  });
});

describe('comment stripping', () => {
  it('does not flag a class name mentioned in a block comment', () => {
    expect(scan(`/** Prefer shadow-e1 over ${raw('md')}; see §5. */\nexport const x = 1;`)).toEqual(
      [],
    );
  });

  it('does not flag a class name mentioned in a JSX block comment', () => {
    expect(scan(`<div>{/* was bg-zinc-900 before #350 */}</div>`)).toEqual([]);
  });

  it('does not flag a class name in a whole-line // comment', () => {
    expect(scan(`  // bg-slate-100 was the old ground\nconst y = 2;`)).toEqual([]);
  });

  it('still flags real code on a line that also carries a trailing comment', () => {
    expect(messages(`const a = "bg-zinc-900"; // intentional`)).toContain('bg-zinc-900');
  });

  it('does not mistake a URL for a line comment and hide code after it', () => {
    const source = `const doc = 'https://example.com/x'; const cls = 'bg-zinc-900';`;
    expect(messages(source)).toContain('bg-zinc-900');
  });

  it('keeps line numbers accurate across a stripped multi-line comment', () => {
    const source = ['/**', ' * a', ' * b', ' */', '<div className="bg-zinc-900" />'].join('\n');
    expect(messages(source)).toContain('fixture.tsx:5');
  });
});

describe('stripComments', () => {
  it('preserves the total line count', () => {
    const source = ['a', '/* one', 'two', 'three */', 'b'].join('\n');
    expect(stripComments(source).split('\n')).toHaveLength(5);
  });
});

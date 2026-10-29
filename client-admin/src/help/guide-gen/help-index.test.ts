// @vitest-environment node
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { buildHelpIndex } from './help-index';

const FEATURES = [{ id: 'demo.one', path: 'demo/one', routes: ['/demo', '/demo/$id'] }];

const page = (lang: 'bn' | 'en', helpIds: string, extra = '') =>
  `<!-- guide:meta
feature: demo.one
title: ${lang} title
summary: ${lang} summary.
helpIds: [${helpIds}]
knownIssues:
  - { id: a, checked: 2026-10-20, issue: 1 }
  - { id: b, checked: 2026-10-20, issue: null }
-->

# T
## Task <a href="#task-main" id="task-main"></a>
## Fix <a href="#task-fix" id="task-fix"></a>
## W <a href="#widget.cards" id="widget.cards"></a>
${extra}
<!-- guide:generated:fields:demo -->
x
<!-- /guide:generated -->
`;

const IDS =
  'demo.one, demo.one.action.save, demo.one.field.date, demo.one.widget.cards, demo.one.action.fix#task-fix';

let root: string;
const put = (rel: string, text: string) => {
  mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
  writeFileSync(path.join(root, rel), text);
};
const writeAll = (bnIds = IDS, enIds = IDS) => {
  put('docs/user-guide/bn/demo/one.md', page('bn', bnIds));
  put('docs/user-guide/en/demo/one.md', page('en', enIds));
  for (const l of ['bn', 'en'])
    put(`ui/src/i18n/locales/${l}/demo.json`, JSON.stringify({ help: { date: 'help' } }));
};

beforeEach(() => {
  root = mkdtempSync(path.join(tmpdir(), 'help-index-'));
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

describe('buildHelpIndex', () => {
  it('builds page, action, field, widget and #anchor entries', () => {
    writeAll();
    const { index, routes } = buildHelpIndex(root, FEATURES);
    expect(index['demo.one']).toEqual({
      title: { bn: 'bn title', en: 'en title' },
      summary: { bn: 'bn summary.', en: 'en summary.' },
      path: 'demo/one',
      anchor: '',
      knownIssues: 2,
    });
    expect(index['demo.one.action.save']!.anchor).toBe('task-main');
    expect(index['demo.one.field.date']).toMatchObject({
      anchor: 'more',
      summary: { bn: '', en: '' },
      field: { ns: 'demo', key: 'date' },
    });
    expect(index['demo.one.widget.cards']!.anchor).toBe('widget.cards');
    expect(index['demo.one.action.fix']!.anchor).toBe('task-fix');
    expect(routes).toEqual({ '/demo': 'demo.one', '/demo/$id': 'demo.one' });
  });

  it('omits video without a manifest and fills it from one', () => {
    writeAll();
    expect(buildHelpIndex(root, FEATURES).index['demo.one']!.video).toBeUndefined();
    put(
      'docs/user-guide/media-manifest.json',
      JSON.stringify({ 'demo.one': { youtube: { bn: 'BN1', en: 'EN1' }, durationSec: 65 } }),
    );
    expect(buildHelpIndex(root, FEATURES).index['demo.one']!.video).toEqual({
      bn: { id: 'BN1', durationSec: 65 },
      en: { id: 'EN1', durationSec: 65 },
    });
  });

  it('throws on a bn page with no en twin', () => {
    writeAll();
    rmSync(path.join(root, 'docs/user-guide/en/demo/one.md'));
    expect(() => buildHelpIndex(root, FEATURES)).toThrow(/no en twin/);
  });

  it('throws on an unknown field key', () => {
    writeAll('demo.one, demo.one.field.ghost');
    expect(() => buildHelpIndex(root, FEATURES)).toThrow(/help\.ghost/);
  });

  it('throws on an anchor missing from a page (en only)', () => {
    writeAll('demo.one#task-main', 'demo.one#task-main');
    put(
      'docs/user-guide/en/demo/one.md',
      page('en', 'demo.one#task-main').replace('id="task-main"', ''),
    );
    expect(() => buildHelpIndex(root, FEATURES)).toThrow(
      /en\/demo\/one: helpId "demo.one#task-main"/,
    );
  });

  it('throws on a blank field help text in one language', () => {
    writeAll('demo.one, demo.one.field.date');
    put('ui/src/i18n/locales/en/demo.json', JSON.stringify({ help: { date: ' ' } }));
    expect(() => buildHelpIndex(root, FEATURES)).toThrow(/help\.date/);
  });

  it('throws when bn and en list a different number of known issues', () => {
    writeAll();
    put('docs/user-guide/en/demo/one.md', page('en', IDS).replace(/^ {2}- \{ id: b.*\n/m, ''));
    expect(() => buildHelpIndex(root, FEATURES)).toThrow(/knownIssues differ \(bn 2, en 1\)/);
  });

  it('throws when two features claim the same route', () => {
    writeAll();
    const two = [...FEATURES, { id: 'demo.two', path: 'demo/two', routes: ['/demo'] }];
    expect(() => buildHelpIndex(root, two)).toThrow(
      'HELP_ROUTES: route "/demo" is claimed by demo.one and demo.two',
    );
  });

  it('throws on a helpId with more than one #', () => {
    writeAll('demo.one#task-main#task-fix');
    expect(() => buildHelpIndex(root, FEATURES)).toThrow(/more than one #/);
  });

  it('a data-id="x" is not an anchor', () => {
    writeAll('demo.one#only-data');
    put(
      'docs/user-guide/bn/demo/one.md',
      page('bn', 'demo.one#only-data', '<p data-id="only-data"></p>'),
    );
    put(
      'docs/user-guide/en/demo/one.md',
      page('en', 'demo.one#only-data', '<p data-id="only-data"></p>'),
    );
    expect(() => buildHelpIndex(root, FEATURES)).toThrow(/no id="only-data"/);
  });

  it('an id rejected for a bad #anchor on one page still indexes from a later page', () => {
    writeAll('demo.one, demo.x.action.go#nope');
    for (const l of ['bn', 'en'] as const)
      put(`docs/user-guide/${l}/demo/two.md`, page(l, 'demo.two, demo.x.action.go'));
    const two = [...FEATURES, { id: 'demo.two', path: 'demo/two', routes: ['/two'] }];
    const r = buildHelpIndex(root, two, { strict: false });
    expect(r.index['demo.x.action.go']).toMatchObject({ path: 'demo/two', anchor: 'task-main' });
    expect(r.gaps).toEqual([
      'bn/demo/one: helpId "demo.x.action.go#nope" has no id="nope" on the page',
    ]);
  });

  it('an id with no field help on one page still indexes from a later page that has it', () => {
    writeAll('demo.one, demo.x.field.zz');
    for (const l of ['bn', 'en'] as const) {
      put(
        `docs/user-guide/${l}/demo/two.md`,
        page(l, 'demo.two, demo.x.field.zz').replace('fields:demo', 'fields:other'),
      );
      put(`ui/src/i18n/locales/${l}/other.json`, JSON.stringify({ help: { zz: 'help' } }));
    }
    const two = [...FEATURES, { id: 'demo.two', path: 'demo/two', routes: ['/two'] }];
    const r = buildHelpIndex(root, two, { strict: false });
    expect(r.index['demo.x.field.zz']).toMatchObject({ path: 'demo/two' });
    expect(r.gaps).toEqual([expect.stringContaining('no help.zz')]);
  });

  it('throws on an id declared twice', () => {
    writeAll('demo.one, demo.one');
    expect(() => buildHelpIndex(root, FEATURES)).toThrow(/declared twice/);
  });

  it('non-strict mode skips offenders and lists them as gaps', () => {
    writeAll('demo.one, demo.one.field.ghost');
    const r = buildHelpIndex(root, FEATURES, { strict: false });
    expect(Object.keys(r.index)).toEqual(['demo.one']);
    expect(r.gaps).toHaveLength(1);
  });
});

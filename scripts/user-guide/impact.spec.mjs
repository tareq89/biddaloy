// [42.1.03] Builds a throwaway git repo (page pair + source + locale files), commits a
// base, applies a change on top, and runs analyze() against it.
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { analyze, readMeta, report } from './impact.mjs';

const PAGE = (lang, video = '') => `<!-- guide:meta
feature: demo.page
title: Demo
sources:
  - client/src/demo/*.tsx
labels: [demo:list.*, common:sync.*]
${video}-->
# ${lang}
`;
const BN = 'docs/user-guide/bn/demo/page.md';
const EN = 'docs/user-guide/en/demo/page.md';
const SRC = 'client/src/demo/a.tsx';
const BN_JSON = 'ui/src/i18n/locales/bn/demo.json';
const EN_JSON = 'ui/src/i18n/locales/en/demo.json';
const OTHER = 'server/other.ts';

let dir;
const git = (...a) => execFileSync('git', a, { cwd: dir, encoding: 'utf8' });
const put = (f, c) => {
  mkdirSync(path.dirname(path.join(dir, f)), { recursive: true });
  writeFileSync(path.join(dir, f), c);
};

function run(change, prBody = '', video = '') {
  dir = mkdtempSync(path.join(tmpdir(), 'impact-'));
  git('init', '-q', '-b', 'main');
  git('config', 'user.email', 't@t');
  git('config', 'user.name', 't');
  put(BN, PAGE('bn', video));
  put(EN, PAGE('en', video));
  put(SRC, 'a');
  put(OTHER, 'a');
  put(BN_JSON, JSON.stringify({ list: { title: 'শিরোনাম' }, misc: 'x' }));
  put(EN_JSON, JSON.stringify({ list: { title: 'Title' }, misc: 'x' }));
  git('add', '-A');
  git('commit', '-qm', 'base');
  git('switch', '-qc', 'pr');
  change();
  git('add', '-A');
  git('commit', '-qm', 'change');
  return analyze({ base: 'main', head: 'pr', prBody, cwd: dir });
}

afterEach(() => dir && rmSync(dir, { recursive: true, force: true }));

describe('guide:impact', () => {
  it('fails when a source changes and no page does', () => {
    const r = run(() => put(SRC, 'b'));
    expect(r.ok).toBe(false);
    expect(r.failing[0].why).toEqual([`source ${SRC}`]);
    expect(report(r)).toContain('demo.page');
  });

  it('passes when the source and both pages change', () => {
    const r = run(() => {
      put(SRC, 'b');
      put(BN, `${PAGE('bn')}x`);
      put(EN, `${PAGE('en')}x`);
    });
    expect(r.ok).toBe(true);
  });

  it('fails when only the bn page changes', () => {
    const r = run(() => {
      put(SRC, 'b');
      put(BN, `${PAGE('bn')}x`);
    });
    expect(r.ok).toBe(false);
    expect(r.failing[0].todo).toEqual([EN]);
  });

  it('fails when a label value changes in one language', () => {
    const r = run(() => put(EN_JSON, JSON.stringify({ list: { title: 'New' }, misc: 'x' })));
    expect(r.ok).toBe(false);
    expect(r.failing[0].why).toEqual(['i18n key en/demo:list.title']);
  });

  it('fails on a new key under a labels glob', () => {
    const r = run(() =>
      put(BN_JSON, JSON.stringify({ list: { title: 'শিরোনাম', sub: 'নতুন' }, misc: 'x' })),
    );
    expect(r.ok).toBe(false);
    expect(r.failing[0].why).toEqual(['i18n key bn/demo:list.sub']);
  });

  it('passes with the opt-out line and a real reason', () => {
    const r = run(() => put(SRC, 'b'), 'text\nUser guide: not affected — internal refactor only\n');
    expect(r.ok).toBe(true);
    expect(r.escaped).toBe(true);
  });

  it('fails when the opt-out reason is too short', () => {
    const r = run(() => put(SRC, 'b'), 'User guide: not affected — typo');
    expect(r.ok).toBe(false);
  });

  it('passes on an unrelated change, including a key outside labels', () => {
    const r = run(() => {
      put(OTHER, 'b');
      put(EN_JSON, JSON.stringify({ list: { title: 'Title' }, misc: 'changed' }));
    });
    expect(r.ok).toBe(true);
    expect(r.rows).toEqual([]);
  });

  it('lists affected pages with a video as possibly stale, without failing', () => {
    const r = run(
      () => {
        put(SRC, 'b');
        put(BN, `${PAGE('bn', 'video: sm_demo\n')}x`);
        put(EN, `${PAGE('en', 'video: sm_demo\n')}x`);
      },
      '',
      'video: sm_demo\n',
    );
    expect(r.ok).toBe(true);
    expect(r.stale).toEqual(['demo.page']);
  });

  it('fails closed without path.matchesGlob', () => {
    const orig = path.matchesGlob;
    path.matchesGlob = undefined;
    try {
      expect(() => analyze({ base: 'main', head: 'pr', cwd: '.' })).toThrow(/matchesGlob/);
    } finally {
      path.matchesGlob = orig;
    }
  });

  it('fails closed on an unknown revision', () => {
    run(() => put(OTHER, 'b'));
    expect(() => analyze({ base: 'nope', head: 'pr', cwd: dir })).toThrow();
  });
});

describe('readMeta', () => {
  it('reads block and multi-line flow lists', () => {
    const m = readMeta(
      '<!-- guide:meta\nfeature: a.b\nsources:\n  - x/*.ts\n  - y.ts\nlabels:\n  [\n    a:*,\n    b:c.*,\n  ]\n-->',
    );
    expect(m).toMatchObject({
      feature: 'a.b',
      sources: ['x/*.ts', 'y.ts'],
      labels: ['a:*', 'b:c.*'],
    });
  });

  it('throws on an unterminated list', () => {
    expect(() => readMeta('<!-- guide:meta\nfeature: a\nlabels: [a, b\n-->')).toThrow();
  });

  it('returns null without a meta comment', () => {
    expect(readMeta('# index')).toBeNull();
  });
});

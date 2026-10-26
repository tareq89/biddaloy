// node --test scripts/user-guide/check.spec.mjs
// One clean fixture tree (fixtures/clean); every failure case copies it to a
// temp dir, breaks one thing, and expects the matching `(x)` problem.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'vitest';
import { fileURLToPath } from 'node:url';
import { check } from './check.mjs';
import { parseMeta } from './frontmatter.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const CLEAN = path.join(here, 'fixtures/clean');
const today = new Date('2026-10-24');
const G = 'docs/user-guide';

function run(mutate) {
  const root = mkdtempSync(path.join(tmpdir(), 'guide-check-'));
  try {
    cpSync(CLEAN, root, { recursive: true });
    mutate?.((rel, fn) => {
      const f = path.join(root, rel);
      writeFileSync(f, typeof fn === 'function' ? fn(readFileSync(f, 'utf8')) : fn);
    }, root);
    return check(root, { today });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

const expectProblem = (code, mutate) => {
  const { problems } = run(mutate);
  assert.ok(
    problems.some((p) => p.problem.startsWith(`(${code})`)),
    `expected (${code}), got ${JSON.stringify(problems)}`,
  );
};
const json = (rel, edit) => (edit2) => edit2(rel, (s) => JSON.stringify(edit(JSON.parse(s)), null, 2));

test('clean tree passes with no warnings', () => {
  const r = run();
  assert.deepEqual(r, { problems: [], warnings: [] });
});

test('cli exits 0 on clean and 1 on a broken tree', () => {
  const script = path.join(here, 'check.mjs');
  assert.equal(spawnSync('node', [script, CLEAN]).status, 0);
  const root = mkdtempSync(path.join(tmpdir(), 'guide-check-'));
  try {
    cpSync(CLEAN, root, { recursive: true });
    writeFileSync(path.join(root, G, 'coverage.json'), '{"demo.one":"done"}');
    const r = spawnSync('node', [script, root], { encoding: 'utf8' });
    assert.equal(r.status, 1);
    assert.match(r.stdout, /"problem":"\(a\)/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('(a) features id missing from coverage', () =>
  expectProblem('a', (w) => json(`${G}/coverage.json`, (c) => ({ 'demo.one': c['demo.one'] }))(w)));
test('(b) done id lacks a page', () =>
  expectProblem('b', (w) => json(`${G}/coverage.json`, (c) => ({ ...c, 'demo.three': 'done' }))(w)));
test('(c) bn/en roles differ', () =>
  expectProblem('c', (w) => w(`${G}/en/demo/one.md`, (s) => s.replace('roles: [ADMIN, TEACHER]', 'roles: [ADMIN]'))));
test('(d) broken image path', () =>
  expectProblem('d', (w) => w(`${G}/en/demo/one.md`, (s) => s.replace('img/dot.png', 'img/nope.png'))));
test('(e) labels glob matches nothing', () =>
  expectProblem('e', (w) => w(`${G}/bn/demo/one.md`, (s) => s.replace('demo:list.*', 'demo:nope.*'))));
test('(f) page without a diagram', () =>
  expectProblem('f', (w) => w(`${G}/bn/demo/two.md`, (s) => s.replace('![flow](diagrams/demo-flow.svg)\n', ''))));
test('(g) stale svg', () =>
  expectProblem('g', (w) => w(`${G}/_diagrams/demo-flow.en.mmd`, (s) => s + '  B --> C\n')));
test('(h) oversized png', () =>
  expectProblem('h', (w, root) => writeFileSync(path.join(root, G, 'en/demo/img/big.png'), Buffer.alloc(301 * 1024))));
test('(i) video file', () =>
  expectProblem('i', (w, root) => writeFileSync(path.join(root, 'docs/clip.mp4'), 'x')));
test('(j) page outside features.json', () =>
  expectProblem('j', (w) => json(`${G}/_generated/features.json`, (f) => f.slice(0, 1))(w)));
test('(k) generated block differs', () =>
  expectProblem('k', (w) => json(`${G}/_generated/blocks.json`, (b) => ({ ...b, en: { 'fields:demo.one': 'Old' } }))(w)));
test('(k) video marker is a failure (D48)', () =>
  expectProblem('k', (w) =>
    w(`${G}/en/demo/two.md`, (s) => s + '\n<!-- guide:generated:video:x -->\n<!-- /guide:generated -->\n'),
  ));
test('(l) route with no feature', () =>
  expectProblem('l', (w) => json('e2e/route-manifest.json', (m) => ({ routes: [...m.routes, { path: '/three' }] }))(w)));
test('(m) page missing #confirm', () =>
  expectProblem('m', (w) =>
    w(`${G}/en/demo/one.md`, (s) => s.replace('## Confirm <a href="#confirm" id="confirm"></a>\n', '')),
  ));
test('(m) bn and en anchor sets differ', () =>
  expectProblem('m', (w) =>
    w(`${G}/en/demo/one.md`, (s) => s + '\n## Extra <a href="#extra" id="extra"></a>\n'),
  ));
test('(n) entry beyond sidebar with no #arrive', () =>
  expectProblem('n', (w) => w(`${G}/bn/demo/one.md`, (s) => s.replace('entry: [sidebar]', 'entry: [notification:x]'))));
test('(o) bolded title without a link', () =>
  expectProblem('o', (w) => w(`${G}/bn/demo/two.md`, (s) => s.replace('[**পাতা এক**](one.md).', '**পাতা এক**.'))));
test('(p) one-way related link', () =>
  expectProblem('p', (w) => w(`${G}/en/demo/two.md`, (s) => s.replace('- [**Page One**](one.md) - related.\n', ''))));
test('(q) stale knownIssues date and null issue warn but do not fail', () => {
  const r = run((w) =>
    w(`${G}/en/demo/one.md`, (s) => s.replace('checked: 2026-10-20, issue: 1', 'checked: 2026-01-01, issue: null')),
  );
  assert.deepEqual(r.problems, []);
  assert.equal(r.warnings.length, 2);
});
test('(r) leftover --- frontmatter', () =>
  expectProblem('r', (w) => w(`${G}/bn/demo/one.md`, (s) => `---\ntitle: x\n---\n${s}`)));

test('(s) image without meaningful alt text', () =>
  expectProblem('s', (w) => w(`${G}/en/demo/one.md`, (s) => s + '\n![](img/dot.png)\n')));
test('(t) a planned id fails (strict coverage, D16)', () =>
  expectProblem('t', (w) => json(`${G}/coverage.json`, (c) => ({ ...c, 'demo.three': 'planned' }))(w)));
test('deleting a page fails the check (the epic-close experiment)', () => {
  const r = run((w, root) => rmSync(path.join(root, G, 'en/demo/two.md')));
  assert.ok(r.problems.some((p) => p.problem.startsWith('(b)')), JSON.stringify(r.problems));
  assert.ok(r.problems.some((p) => p.problem.startsWith('(c)')), JSON.stringify(r.problems));
});

test('missing features.json and blocks.json skip their checks with a warning', () => {
  const r = run((w, root) => {
    rmSync(path.join(root, G, '_generated'), { recursive: true });
  });
  assert.deepEqual(r.problems, []);
  assert.equal(r.warnings.length, 2);
});

test('parseMeta reads scalars, flow lists, multi-line lists, block lists and flow maps', () => {
  const fm = parseMeta(
    [
      'feature: a.b          # id',
      'issueRef: #12',
      'labels:',
      '  [x:y.*,',
      '    z:w]',
      'knownIssues:',
      '  - { id: s, checked: 2026-10-23, issue: null }',
      'sources:',
      '  - a/b.tsx',
    ].join('\n'),
  );
  assert.deepEqual(fm, {
    feature: 'a.b',
    issueRef: '#12',
    labels: ['x:y.*', 'z:w'],
    knownIssues: [{ id: 's', checked: '2026-10-23', issue: null }],
    sources: ['a/b.tsx'],
  });
});

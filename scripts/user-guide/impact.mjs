// [42.1.03] guide:impact — fails a PR that changes code or UI words a guide page
// documents (its `sources` / `labels`) without also touching that page in bn + en.
// Opt-out: a PR body line `User guide: not affected — <reason>` (reason >= 10 chars).
//
//   node scripts/user-guide/impact.mjs [--base <sha>] [--head <sha>]   env PR_BODY (optional)
//
// Fails closed: git errors, an unreadable page header or a missing path.matchesGlob
// exit 1. The PR body is only ever read from the environment and matched against a
// regex; it is never passed to a shell.
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ESCAPE = /^User guide: not affected — .{10,}/m;
const LANGS = ['bn', 'en'];
const LOCALE = /^ui\/src\/i18n\/locales\/(bn|en)\/([^/]+)\.json$/;
const PAGE = /^docs\/user-guide\/(bn|en)\/.+\.md$/;

const git = (cwd, ...args) =>
  execFileSync('git', args, { cwd, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
const show = (cwd, rev, file) => {
  try {
    return git(cwd, 'show', `${rev}:${file}`);
  } catch {
    return null; // file absent at that revision
  }
};

// Tiny reader for the `<!-- guide:meta … -->` comment: only `feature`, `sources`,
// `labels` and `video`, in block (`- a`) or flow (`[a, b]`, maybe multi-line) form.
export function readMeta(text) {
  const m = /<!--\s*guide:meta\b([\s\S]*?)-->/.exec(text);
  if (!m) return null;
  const meta = { sources: [], labels: [] };
  const lines = m[1].split('\n');
  const unq = (s) => s.trim().replace(/^["']|["']$/g, '');
  for (let i = 0; i < lines.length; i++) {
    const kv = /^([A-Za-z]+):\s*(.*)$/.exec(lines[i]);
    if (!kv) continue;
    const [, key, rest] = kv;
    if (key === 'feature' || key === 'video') {
      meta[key] = unq(rest);
    } else if (key === 'sources' || key === 'labels') {
      let flow = rest;
      if (!flow.trim()) {
        while (/^\s*-\s+\S/.test(lines[i + 1] ?? '')) {
          meta[key].push(unq(lines[++i].replace(/^\s*-\s+/, '')));
        }
        if (meta[key].length || !/^\s*\[/.test(lines[i + 1] ?? '')) continue;
        flow = lines[++i];
      }
      while (flow.includes('[') && !flow.includes(']') && i + 1 < lines.length) flow += lines[++i];
      const inner = /\[([\s\S]*)\]/.exec(flow);
      if (!inner) throw new Error(`unreadable ${key} list in guide:meta`);
      meta[key].push(...inner[1].split(',').map(unq).filter(Boolean));
    }
  }
  return meta;
}

const isObj = (v) => v && typeof v === 'object' && !Array.isArray(v);
function flatten(obj, prefix = '', out = {}) {
  for (const [k, v] of Object.entries(obj)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (isObj(v)) flatten(v, key, out);
    else out[key] = JSON.stringify(v);
  }
  return out;
}
const flatAt = (cwd, rev, file) => {
  const text = show(cwd, rev, file);
  return text === null ? {} : flatten(JSON.parse(text));
};

export function analyze({ base = 'origin/main', head = 'HEAD', prBody = '', cwd = process.cwd() }) {
  const matchesGlob = path.matchesGlob;
  if (typeof matchesGlob !== 'function') {
    throw new Error('path.matchesGlob is unavailable; guide:impact needs Node >= 22');
  }
  const mergeBase = git(cwd, 'merge-base', base, head).trim();
  const changed = git(cwd, 'diff', '--name-only', mergeBase, head).split('\n').filter(Boolean);
  const changedSet = new Set(changed);

  // Changed i18n keys as `ns:key` per language.
  const changedKeys = []; // { lang, id }
  for (const file of changed) {
    const lm = LOCALE.exec(file);
    if (!lm) continue;
    const [, lang, ns] = lm;
    const before = flatAt(cwd, mergeBase, file);
    const after = flatAt(cwd, head, file);
    for (const k of new Set([...Object.keys(before), ...Object.keys(after)])) {
      if (before[k] !== after[k]) changedKeys.push({ lang, id: `${ns}:${k}` });
    }
  }

  // Pages at head, grouped by feature.
  const pages = new Map(); // feature -> { files: {lang: file}, meta }
  for (const file of git(cwd, 'ls-tree', '-r', '--name-only', head, 'docs/user-guide')
    .split('\n')
    .filter((f) => PAGE.test(f))) {
    let meta;
    try {
      meta = readMeta(show(cwd, head, file));
    } catch (e) {
      throw new Error(`${file}: ${e.message}`);
    }
    if (!meta) continue; // index / SUMMARY files carry no metadata
    if (!meta.feature) throw new Error(`${file}: guide:meta has no feature`);
    const lang = PAGE.exec(file)[1];
    const entry = pages.get(meta.feature) ?? { files: {}, meta: { sources: [], labels: [] } };
    entry.files[lang] = file;
    entry.meta = {
      sources: [...entry.meta.sources, ...meta.sources], // union: bn and en may drift
      labels: [...entry.meta.labels, ...meta.labels],
      video: entry.meta.video ?? meta.video,
    };
    pages.set(meta.feature, entry);
  }

  const rows = [];
  for (const [feature, { files, meta }] of pages) {
    const why = [];
    for (const f of changed) {
      if (meta.sources.some((g) => matchesGlob(f, g))) why.push(`source ${f}`);
    }
    for (const { lang, id } of changedKeys) {
      if (meta.labels.some((g) => matchesGlob(id, g))) why.push(`i18n key ${lang}/${id}`);
    }
    if (!why.length) continue;
    const todo = LANGS.filter((l) => !files[l] || !changedSet.has(files[l])).map(
      (l) => files[l] ?? `docs/user-guide/${l}/… (page missing)`,
    );
    rows.push({ feature, why: [...new Set(why)], todo, video: meta.video });
  }

  const failing = rows.filter((r) => r.todo.length);
  const escaped = ESCAPE.test(prBody);
  return {
    rows,
    failing,
    escaped,
    ok: failing.length === 0 || escaped,
    stale: rows.filter((r) => r.video).map((r) => r.feature),
  };
}

export function report(res) {
  const out = [];
  if (res.rows.length) {
    out.push('page · why affected · what to do');
    for (const r of res.rows) {
      const act = r.todo.length ? `update ${r.todo.join(' and ')}` : 'ok (bn + en updated)';
      out.push(`${r.feature} · ${r.why.join(', ')} · ${act}`);
    }
  } else out.push('guide:impact: no guide page affected');
  if (res.stale.length) out.push(`media possibly stale (soft): ${res.stale.join(', ')}`);
  if (res.failing.length) {
    out.push(
      res.escaped
        ? 'User guide opt-out line found; passing.'
        : 'FAIL: update the pages above (bn + en), or add a PR body line: "User guide: not affected — <reason of 10+ characters>"',
    );
  }
  return out.join('\n');
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const a = process.argv.slice(2);
    const arg = (n) => {
      if (!a.includes(n)) return undefined;
      const v = a[a.indexOf(n) + 1];
      if (!v || v.startsWith('-')) throw new Error(`${n} needs a revision`);
      return v;
    };
    const res = analyze({
      base: arg('--base'),
      head: arg('--head'),
      prBody: process.env.PR_BODY ?? '',
    });
    console.log(report(res));
    process.exit(res.ok ? 0 : 1);
  } catch (e) {
    console.error(`guide:impact failed closed: ${e.message}`);
    process.exit(1);
  }
}

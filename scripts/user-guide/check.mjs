#!/usr/bin/env node
// [Epic 42] `guide:check` (#2518): fails loudly on every structural way the
// user guide can be wrong. One JSON line `{file, problem}` per problem, exit 1.
// Warnings (`{file, warning}`) go to stderr and never change the exit code.
//
//   node scripts/user-guide/check.mjs [rootDir]
//
// Inputs (written by 42.1.04 / lane g4, never by hand):
//   docs/user-guide/_generated/features.json  [{ id, kind, path, route, routes, roles }]
//     `path` is relative to the language folder, with or without ".md"
//     ("attendance/attendance").
//   docs/user-guide/_generated/blocks.json    { "<lang>": { "<kind>:<id>": "<block content>" } }
// While either file is missing, the checks that need it are skipped with a warning.
//
// A page is "a guide page" when it has a `<!-- guide:meta -->` comment (or still
// carries `---` frontmatter, which is check (r)). README, SUMMARY and the older
// hand-written pages without metadata are not checked.
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { checkAltText } from './alt-text.mjs';
import { listPages, readPage } from './frontmatter.mjs';

const LANGS = ['bn', 'en'];
const REQUIRED_IDS = ['task-main', 'confirm', 'other', 'trouble', 'roles', 'more'];
const RELATED = /^\*\*(সম্পর্কিত পাতা|Related pages)\*\*\s*$/m;
const DAY = 86400000;

const readJson = (file, fallback) =>
  existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : fallback;
const sha1 = (s) => createHash('sha1').update(s).digest('hex');
const sortedKey = (v) => JSON.stringify([...(v ?? [])].sort());
const stripCode = (s) => s.replace(/```[\s\S]*?```/g, '').replace(/`[^`\n]*`/g, '');
const norm = (p) => p.replace(/\.md$/, '');
// Anchor ids declared as `<a … id="x">` on a heading line.
const anchorIds = (body) =>
  [...body.matchAll(/^#{1,6} .*<a [^>]*(?<![\w-])id="([^"]+)"/gm)].map((m) => m[1]);

function flatten(obj, prefix = '', out = []) {
  for (const [k, v] of Object.entries(obj)) {
    if (v && typeof v === 'object') flatten(v, `${prefix}${k}.`, out);
    else out.push(prefix + k);
  }
  return out;
}

function walk(dir, out = []) {
  if (!existsSync(dir)) return out;
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else out.push(full);
  }
  return out;
}

export function check(root = '.', { today = new Date() } = {}) {
  const problems = [];
  const warnings = [];
  const guide = path.join(root, 'docs/user-guide');
  const rel = (f) => path.relative(root, f);
  const fail = (file, problem) => problems.push({ file, problem });
  const warn = (file, warning) => warnings.push({ file, warning });

  const featuresFile = path.join(guide, '_generated/features.json');
  const blocksFile = path.join(guide, '_generated/blocks.json');
  const features = existsSync(featuresFile) ? readJson(featuresFile) : null;
  const blocks = existsSync(blocksFile) ? readJson(blocksFile) : null;
  const coverage = readJson(path.join(guide, 'coverage.json'), {});
  const routeMap = readJson(path.join(guide, 'route-map.json'), {});
  if (!features) warn(rel(featuresFile), 'missing: checks (a), (j), (l) skipped');
  if (!blocks) warn(rel(blocksFile), 'missing: check (k) skipped');

  // ---- load pages -------------------------------------------------------
  const pages = {}; // lang -> Map(relPath -> { file, fm, body, legacy })
  for (const lang of LANGS) {
    pages[lang] = new Map();
    for (const p of listPages(lang, root)) {
      const file = path.join(guide, lang, p);
      const { fm, body, legacyFrontmatter } = readPage(file);
      if (legacyFrontmatter)
        fail(
          rel(file),
          '(r) still has --- frontmatter; metadata belongs in a <!-- guide:meta --> comment',
        );
      if (fm) pages[lang].set(p, { file, fm, body });
    }
  }
  const done = (page) => coverage[page.fm.feature] === 'done';

  // ---- (a) features id missing from coverage ----------------------------
  for (const f of features ?? [])
    if (!(f.id in coverage))
      fail(
        rel(path.join(guide, 'coverage.json')),
        `(a) feature "${f.id}" is missing from coverage.json`,
      );

  // ---- (b) done id lacks a bn or en page --------------------------------
  for (const [id, status] of Object.entries(coverage)) {
    if (status !== 'done') continue;
    for (const lang of LANGS)
      if (![...pages[lang].values()].some((p) => p.fm.feature === id))
        fail(rel(path.join(guide, 'coverage.json')), `(b) "${id}" is done but has no ${lang} page`);
  }

  // ---- (t) a `planned` id (strict coverage, D16) ---------------------------
  // D16: every coverage id is `done`; there are no exceptions.
  for (const [id, status] of Object.entries(coverage)) {
    if (status !== 'planned') continue;
    fail(
      rel(path.join(guide, 'coverage.json')),
      `(t) "${id}" is still planned; every id must be done (D16)`,
    );
  }

  // ---- (u) a helpIds `#anchor` suffix must be an id="…" on that page (E20) --
  // `attendance.attendance.action.fix#task-fix` links the (?) to a section; bn and en share anchors.
  for (const lang of LANGS)
    for (const pg of pages[lang].values()) {
      // Any `id="…"` (glossary rows carry inline anchors), but not `data-id="…"`.
      const ids = new Set([...pg.body.matchAll(/(?<![\w-])id="([^"]+)"/g)].map((m) => m[1]));
      for (const entry of pg.fm.helpIds ?? []) {
        const anchor = String(entry).split('#')[1];
        if (anchor === undefined) continue;
        if (!ids.has(anchor))
          fail(rel(pg.file), `(u) helpIds "${entry}": no id="${anchor}" on the page`);
      }
    }

  // ---- (c) bn/en pair differs -------------------------------------------
  for (const [p, bn] of pages.bn) {
    const en = pages.en.get(p);
    if (!en) {
      fail(rel(bn.file), `(c) no en page at the same path (${p})`);
      continue;
    }
    for (const key of ['feature', 'roles', 'helpIds']) {
      const [x, y] =
        key === 'feature'
          ? [bn.fm[key], en.fm[key]]
          : [sortedKey(bn.fm[key]), sortedKey(en.fm[key])];
      if (x !== y) fail(rel(bn.file), `(c) ${key} differs between bn and en`);
    }
  }
  for (const p of pages.en.keys())
    if (!pages.bn.has(p)) fail(rel(pages.en.get(p).file), `(c) no bn page at the same path (${p})`);

  for (const lang of LANGS) {
    // Portal pages are named after the app's own menu labels ("Attendance", "Results"), so
    // their titles cannot be told apart from a bold UI word: (o) leaves them out both ways.
    const titles = [...pages[lang]]
      .filter(([p, pg]) => done(pg) && !p.startsWith('portal/'))
      .map(([p, pg]) => ({ p, title: pg.fm.title }));
    for (const [p, pg] of pages[lang]) {
      const file = rel(pg.file);
      const text = stripCode(pg.body);

      // ---- (d) broken relative links / images ---------------------------
      const targets = [
        ...[...text.matchAll(/!?\[[^\]]*\]\(([^)\s]+)[^)]*\)/g)].map((m) => m[1]),
        ...[...text.matchAll(/<img\b[^>]*\bsrc="([^"]+)"/g)].map((m) => m[1]),
        ...[...text.matchAll(/<a\b[^>]*\bhref="([^"]+)"/g)].map((m) => m[1]),
      ];
      for (const t of targets) {
        if (/^([a-z][a-z0-9+.-]*:|#|\/)/i.test(t)) continue;
        const target = path.join(path.dirname(pg.file), decodeURI(t.split('#')[0]));
        if (!existsSync(target)) fail(file, `(d) broken link or image: ${t}`);
      }

      // ---- (e) labels globs match no i18n key ---------------------------
      for (const label of pg.fm.labels ?? []) {
        const [ns, glob = '*'] = String(label).split(':');
        const nsFile = path.join(root, 'ui/src/i18n/locales', lang, `${ns}.json`);
        if (!existsSync(nsFile)) {
          fail(file, `(e) label "${label}": no locale file ${rel(nsFile)}`);
          continue;
        }
        const re = new RegExp(
          `^${glob
            .split('*')
            .map((s) => s.replace(/[.+?^${}()|[\]\\]/g, '\\$&'))
            .join('.*')}$`,
        );
        if (!flatten(readJson(nsFile)).some((k) => re.test(k)))
          fail(file, `(e) label "${label}" matches no key in ${rel(nsFile)}`);
      }

      // ---- (f) page without a diagram -----------------------------------
      if (pg.fm.feature !== 'help.glossary' && !/diagrams\/[^")\s]+\.svg/.test(text))
        fail(file, '(f) no diagrams/*.svg image');

      // ---- (j) page outside features.json paths -------------------------
      if (
        features &&
        !features.some((f) => norm(f.path) === norm(p)) &&
        !/^(help|start)\/index\.md$/.test(p)
      )
        fail(file, '(j) page is not listed in features.json');

      // ---- (k) generated blocks, and no video (D48) ---------------------
      for (const m of pg.body.matchAll(
        /<!-- guide:generated:(\w+):([^\s]+) -->([\s\S]*?)<!-- \/guide:generated -->/g,
      )) {
        if (m[1] === 'video') {
          fail(file, '(k) guide:generated:video block: videos are out of this release (D48)');
          continue;
        }
        if (!blocks) continue;
        const want = blocks[lang]?.[`${m[1]}:${m[2]}`];
        if (want === undefined)
          fail(file, `(k) generated block ${m[1]}:${m[2]} has no entry in blocks.json`);
        else if (m[3].trim() !== want.trim())
          fail(file, `(k) generated block ${m[1]}:${m[2]} differs from what guide:gen writes`);
      }

      // ---- (m) anchor ids ------------------------------------------------
      const ids = anchorIds(pg.body);
      // help/ pages (glossary, ...) are reference pages, not task pages
      if (done(pg) && !p.startsWith('help/')) {
        for (const id of REQUIRED_IDS)
          if (!ids.includes(id)) fail(file, `(m) missing required anchor id "${id}"`);
        const other = pages[lang === 'bn' ? 'en' : 'bn'].get(p);
        if (lang === 'bn' && other && sortedKey(ids) !== sortedKey(anchorIds(other.body)))
          fail(file, '(m) bn and en pages have different anchor ids');
      }

      // ---- (n) entry vs #arrive -----------------------------------------
      const entry = pg.fm.entry ?? [];
      const hasArrive = ids.includes('arrive');
      if (entry.some((e) => e !== 'sidebar' && e !== 'palette') && !hasArrive)
        fail(file, '(n) entry lists more than sidebar/palette but there is no #arrive heading');
      if (hasArrive && entry.length === 0)
        fail(file, '(n) #arrive exists but entry is missing in guide:meta');

      // ---- (o) bolded page title without a link (D46) -------------------
      if (done(pg) && !p.startsWith('portal/'))
        for (const m of text.matchAll(/(\[\s*)?\*\*([^*\n]+)\*\*/g)) {
          const hit = titles.find((t) => t.p !== p && t.title === m[2].trim());
          if (hit && !m[1])
            fail(file, `(o) bolds the title of page "${hit.title}" without linking it`);
        }

      // ---- (p) related pages link back (D46) ----------------------------
      const related = pg.body.match(RELATED);
      if (related) {
        for (const t of relatedLinks(pg.body)) {
          const targetRel = path.relative(
            path.join(guide, lang),
            path.join(path.dirname(pg.file), t.split('#')[0]),
          );
          const back = pages[lang].get(targetRel);
          if (!back) continue; // a broken or non-guide target is (d)'s job
          const backs = relatedLinks(back.body).some(
            (b) =>
              path.relative(
                path.join(guide, lang),
                path.join(path.dirname(back.file), b.split('#')[0]),
              ) === p,
          );
          if (!backs) fail(file, `(p) related link ${t} does not link back`);
        }
      }

      // ---- (q) warnings ---------------------------------------------------
      for (const k of pg.fm.knownIssues ?? []) {
        if (k.checked && today - new Date(k.checked) > 30 * DAY)
          warn(file, `knownIssues "${k.id}" last checked ${k.checked}, over 30 days ago`);
        if (k.issue == null && done(pg)) warn(file, `knownIssues "${k.id}" has no issue number`);
      }
    }
  }

  // the longest existing section folder that prefixes the diagram name ("exams-results-x" → exams-results/)
  const sectionOf = (lang, name) =>
    readdirSync(path.join(guide, lang), { withFileTypes: true })
      .filter((d) => d.isDirectory() && (name === d.name || name.startsWith(`${d.name}-`)))
      .map((d) => d.name)
      .sort((a, b) => b.length - a.length)[0] ?? name.split('-')[0];

  // ---- (g) diagram sources vs svg hash -----------------------------------
  const srcDir = path.join(guide, '_diagrams');
  for (const f of existsSync(srcDir) ? readdirSync(srcDir) : []) {
    const m = f.match(/^(.+)\.(bn|en)\.mmd$/);
    if (!m) continue;
    const svg = path.join(guide, m[2], sectionOf(m[2], m[1]), 'diagrams', `${m[1]}.svg`);
    const want = sha1(readFileSync(path.join(srcDir, f), 'utf8'));
    if (!existsSync(svg)) fail(rel(path.join(srcDir, f)), `(g) no rendered svg at ${rel(svg)}`);
    else if (readFileSync(svg, 'utf8').match(/<!-- src:([0-9a-f]+) -->/)?.[1] !== want)
      fail(rel(svg), '(g) svg is stale: its .mmd source changed; run render-diagrams');
  }

  // ---- (h) guide media size (other docs/ images are not ours), (i) no video under docs/ ----
  for (const f of walk(path.join(root, 'docs'))) {
    const size = statSync(f).size;
    const inGuide = f.startsWith(guide + path.sep);
    if (inGuide && /\.png$/i.test(f) && size > 300 * 1024)
      fail(rel(f), `(h) png is ${Math.round(size / 1024)} KB, limit 300 KB`);
    if (inGuide && /\.gif$/i.test(f) && size > 2 * 1024 * 1024)
      fail(rel(f), `(h) gif is ${Math.round(size / 1024)} KB, limit 2048 KB`);
    if (/\.(mp4|mov|webm)$/i.test(f)) fail(rel(f), '(i) video files are not allowed under docs/');
  }

  // ---- (s) every image has meaningful alt text ------------------------------
  for (const p of checkAltText(root)) fail(p.file, p.problem);

  // ---- (l) every manifest route maps to a feature or an internal reason ----
  const manifestFile = path.join(root, 'e2e/route-manifest.json');
  if (features && existsSync(manifestFile)) {
    // A feature owns its routes and every sub-route under them (detail pages, `$id` params).
    const owned = features.flatMap((f) => [...(f.routes ?? []), f.route].filter(Boolean));
    const mapped = {
      has: (r) => owned.some((o) => r === o || (o !== '/' && r.startsWith(o + '/'))),
    };
    for (const { path: route } of readJson(manifestFile).routes) {
      if (mapped.has(route)) continue;
      if (/^internal: ./.test(routeMap[route] ?? '')) continue;
      fail(
        'e2e/route-manifest.json',
        `(l) route ${route} maps to no feature and has no "internal:" entry in route-map.json`,
      );
    }
  }

  return { problems, warnings };
}

// Links under the **সম্পর্কিত পাতা** / **Related pages** label, until the next rule.
function relatedLinks(body) {
  const m = body.match(RELATED);
  if (!m) return [];
  const tail = body.slice(m.index + m[0].length).split(/^---\s*$/m)[0];
  return [...tail.matchAll(/\]\(([^)\s#]+\.md)(?:#[^)]*)?\)/g)].map((x) => x[1]);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { problems, warnings } = check(process.argv[2] ?? '.');
  for (const w of warnings) console.error(JSON.stringify(w));
  for (const p of problems) console.log(JSON.stringify(p));
  process.exit(problems.length ? 1 : 0);
}

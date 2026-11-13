#!/usr/bin/env node
/**
 * Epic 77 D19/D49: page copy uses the school's own word for class, section,
 * student, guardian, teacher. Replaces the STAND-ALONE stock word inside a
 * locale string with i18next nesting, e.g. "Open the Section" becomes
 * "Open the $t(common:entities.section_one)". The word itself comes from
 * `common:entities.*`, which `applyTenantWords` overrides at runtime.
 *
 *   node scripts/codemods/entity-words.mjs --dry [--out FILE]   all namespaces, writes nothing
 *   node scripts/codemods/entity-words.mjs --apply ns1,ns2      rewrite those namespaces (en + bn)
 *   node scripts/codemods/entity-words.mjs --check              fail if a bare word is left in a converted ns
 *
 * Converted namespaces + intentional leftovers live in entity-words.converted.json.
 * Never touched: help.* / fields.* / label keys that have a help.<key>
 * sibling (the guide generator reads them), glossary/legal/roles paths,
 * strings with {{count}}, en words after "a"/"an", bn words with a case
 * suffix or classifier. Lowercase en words ("this class") are left alone:
 * nesting cannot lowercase; they are counted as `lower` in the dry run.
 */
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '../..');
const LOCALES = join(root, 'ui/src/i18n/locales');
const STATE = join(here, 'entity-words.converted.json');
const LANGS = ['en', 'bn'];
// `designations`: server/src/modules/users/staff-bulk-upload.parser.ts accepts these exact label
// strings in an uploaded staff file (staff-bulk-upload.labels.spec.ts guards the drift), so they are
// workbook values (D5) and must stay stock text.
const SKIP_SEGMENTS = new Set([
  'help',
  'fields',
  'glossary',
  'legal',
  'terms',
  'privacy',
  'roles',
  'designations',
  // settings.json Words tab: the 'Stock word' column and the module/word/kind NAMES must stay
  // stock text; a nested word would show the school's own word where the stock one is meant.
  'modulesWords',
  'kinds',
  'kindNames',
]);
// common: entities.* lives here. dashboard, nav, teacherAssignments: the guide generator
// (client-admin/src/help/guide-gen) copies their strings into docs/user-guide/**, where a
// `$t(...)` would print raw and regenerate committed files. Convert once the generator resolves nesting.
// platform, schoolControl, schoolsList: render only under client-admin/src/routes/_platform and
// features/cockpit, where there is no school profile, so a nested word would always resolve to the stock
// word. verify: public pages (/v/$token, /i/$token) with no tenant profile loaded. demo: its "শাখা" means
// branch (a tenant, Epic 33), not section. calendarImport: `columns.*` are the import preview's column
// names for an uploaded calendar file.
const SKIP_NS = new Set([
  'common',
  'dashboard',
  'nav',
  'teacherAssignments',
  'platform',
  'schoolControl',
  'schoolsList',
  'verify',
  'demo',
  'calendarImport',
]);

// word -> [entity key, plural form]
const EN = {
  Class: ['class', 'one'],
  Classes: ['class', 'other'],
  Section: ['section', 'one'],
  Sections: ['section', 'other'],
  Student: ['student', 'one'],
  Students: ['student', 'other'],
  Guardian: ['guardian', 'one'],
  Guardians: ['guardian', 'other'],
  Teacher: ['teacher', 'one'],
  Teachers: ['teacher', 'other'],
};
const BN = {
  শ্রেণি: 'class',
  শাখা: 'section',
  শিক্ষার্থী: 'student',
  অভিভাবক: 'guardian',
  শিক্ষক: 'teacher',
};
const nest = (k, form) => `$t(common:entities.${k}_${form})`;

// Parts of a value no replacement may enter: interpolations, nesting, markup tags.
const PROTECTED = /\{\{[^}]*\}\}|\$t\([^)]*\)|<[^>]*>/g;
const EN_RE =
  /\b(Classes|Class|Sections|Section|Students|Student|Guardians|Guardian|Teachers|Teacher)\b/g;
const EN_LOWER =
  /\b(classes|class|sections|section|students|student|guardians|guardian|teachers|teacher)\b/g;
const BN_RE = /(?<![ঀ-৿])(শ্রেণি|শাখা|শিক্ষার্থী|অভিভাবক|শিক্ষক)(?![ঀ-৿])/g;
const BN_CLASSIFIER = /^\s+(টি|টা|জন|গুলো|গুলি|সমূহ)(?![ঀ-৿])/;
const AAN_BEFORE = /\b[Aa]n?\s$/;

function walk(obj, path, out) {
  for (const [k, v] of Object.entries(obj)) {
    const p = [...path, k];
    if (typeof v === 'string') out.push({ path: p, value: v });
    else if (v && typeof v === 'object') walk(v, p, out);
  }
  return out;
}

function skipReason(ns, path, value, help) {
  if (SKIP_NS.has(ns)) return 'ns-excluded';
  if (path.some((s) => SKIP_SEGMENTS.has(s))) return 'protected-path';
  if (path.length === 1 && help && Object.hasOwn(help, path[0])) return 'guide-label';
  if (/\{\{\s*count\b/.test(value)) return 'count';
  return null;
}

/** Split a value into [isProtected, text] pieces. */
function split(value) {
  const segs = [];
  let last = 0;
  for (const m of value.matchAll(PROTECTED)) {
    segs.push([false, value.slice(last, m.index)], [true, m[0]]);
    last = m.index + m[0].length;
  }
  segs.push([false, value.slice(last)]);
  return segs;
}

/** { text, n, skipped:[{why, word}], lower } for one value. */
export function convert(value, lang) {
  const skipped = [];
  let n = 0;
  let lower = 0;
  let before = '';
  const text = split(value)
    .map(([prot, s]) => {
      let out = s;
      if (!prot && lang === 'en') {
        lower += (s.match(EN_LOWER) ?? []).length;
        out = s.replace(EN_RE, (w, _g, off) => {
          if (AAN_BEFORE.test(before + s.slice(0, off)))
            return (skipped.push({ why: 'a/an', word: w }), w);
          n++;
          return nest(...EN[w]);
        });
      } else if (!prot) {
        out = s.replace(BN_RE, (w, _g, off) => {
          if (BN_CLASSIFIER.test(s.slice(off + w.length)))
            return (skipped.push({ why: 'bn-classifier', word: w }), w);
          n++;
          return nest(BN[w], 'one');
        });
      }
      before += s;
      return out;
    })
    .join('');
  return { text, n, skipped, lower };
}

const file = (lang, ns) => join(LOCALES, lang, `${ns}.json`);
const namespaces = () =>
  readdirSync(join(LOCALES, 'en'))
    .filter((f) => f.endsWith('.json'))
    .map((f) => f.slice(0, -5))
    .sort();
const read = (lang, ns) => JSON.parse(readFileSync(file(lang, ns), 'utf8'));

/** Walk one namespace+lang; returns per-leaf results. `edit` mutates a clone. */
function scan(ns, lang) {
  const data = read(lang, ns);
  const leaves = walk(data, [], []);
  const stats = { n: 0, lower: 0, strings: 0, skips: {} };
  const review = [];
  const edits = [];
  for (const { path, value } of leaves) {
    const why = skipReason(ns, path, value, data.help);
    if (why) {
      const probe = lang === 'en' ? new RegExp(EN_RE.source) : new RegExp(BN_RE.source);
      if (probe.test(value)) {
        stats.skips[why] = (stats.skips[why] ?? 0) + 1;
        review.push(`${lang} ${ns}:${path.join('.')} [${why}] ${value}`);
      }
      continue;
    }
    const r = convert(value, lang);
    stats.lower += r.lower;
    for (const s of r.skipped) {
      stats.skips[s.why] = (stats.skips[s.why] ?? 0) + 1;
      review.push(`${lang} ${ns}:${path.join('.')} [${s.why}:${s.word}] ${value}`);
    }
    if (r.n) {
      stats.n += r.n;
      stats.strings++;
      edits.push({ path, text: r.text, from: value });
      review.push(`${lang} ${ns}:${path.join('.')} ${value}  =>  ${r.text}`);
    }
  }
  return { data, stats, review, edits };
}

function setPath(obj, path, text) {
  let o = obj;
  for (const k of path.slice(0, -1)) o = o[k];
  o[path.at(-1)] = text;
}

const state = () =>
  existsSync(STATE) ? JSON.parse(readFileSync(STATE, 'utf8')) : { converted: [], allow: {} };

function dry(out) {
  const rows = [];
  const lines = [];
  for (const ns of namespaces()) {
    const e = scan(ns, 'en');
    const b = scan(ns, 'bn');
    const skips = { ...e.stats.skips };
    for (const [k, v] of Object.entries(b.stats.skips)) skips[k] = (skips[k] ?? 0) + v;
    rows.push({
      ns,
      en: e.stats.n,
      bn: b.stats.n,
      strings: e.stats.strings + b.stats.strings,
      lower: e.stats.lower,
      skips,
    });
    lines.push(`## ${ns}`, ...e.review, ...b.review, '');
  }
  console.log('ns | en repl | bn repl | strings | en lower left | skipped');
  for (const r of rows)
    console.log(
      `${r.ns} | ${r.en} | ${r.bn} | ${r.strings} | ${r.lower} | ${JSON.stringify(r.skips)}`,
    );
  const sum = (k) => rows.reduce((a, r) => a + r[k], 0);
  console.log(`TOTAL | ${sum('en')} | ${sum('bn')} | ${sum('strings')} | ${sum('lower')}`);
  if (out) writeFileSync(out, lines.join('\n'));
}

function apply(list) {
  const st = state();
  for (const ns of list) {
    for (const lang of LANGS) {
      const { data, edits } = scan(ns, lang);
      if (!edits.length) continue;
      for (const { path, text } of edits) setPath(data, path, text);
      writeFileSync(file(lang, ns), `${JSON.stringify(data, null, 2)}\n`);
    }
    if (!st.converted.includes(ns)) st.converted.push(ns);
    console.log(`converted ${ns}`);
  }
  st.converted.sort();
  writeFileSync(STATE, `${JSON.stringify(st, null, 2)}\n`);
}

/** Bare stock words left in converted namespaces, minus the allow-list ("lang:ns:path" -> reason). */
export function check() {
  const st = state();
  const left = [];
  for (const ns of st.converted) {
    for (const lang of LANGS) {
      for (const { path, from } of scan(ns, lang).edits) {
        const id = `${lang}:${ns}:${path.join('.')}`;
        if (!Object.hasOwn(st.allow, id)) left.push(`${id} ${from}`);
      }
    }
  }
  return left;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const a = process.argv.slice(2);
  if (a[0] === '--dry') dry(a[1] === '--out' ? a[2] : undefined);
  else if (a[0] === '--apply') apply(a[1].split(','));
  else if (a[0] === '--check') {
    const left = check();
    left.forEach((l) => console.error(l));
    process.exit(left.length ? 1 : 0);
  } else {
    console.error('usage: --dry [--out FILE] | --apply ns1,ns2 | --check');
    process.exit(2);
  }
}

#!/usr/bin/env node
// [Epic 42] #2557: every real image in the user guide needs meaningful alt text.
// Finds `![alt](src)`, `<img alt="...">` (incl. inside <figure>) in every guide
// page and reports the ones whose alt text is missing, empty, a generic word
// ("image", "screenshot", "ছবি"...) or just the file name.
//
//   node scripts/user-guide/alt-text.mjs [rootDir]      one JSON line per problem, exit 1
//
// check.mjs wires it as rule (s) (done at the epic close, 42.6.06):
//   import { checkAltText } from './alt-text.mjs';
//   ... inside check(): for (const p of checkAltText(root)) fail(p.file, p.problem);
// `<!-- image pending -->` comments and fenced / inline code are not images.
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const GENERIC = new Set([
  'image', 'img', 'picture', 'pic', 'photo', 'screenshot', 'screen shot', 'screen', 'diagram', 'figure',
  'graphic', 'icon', 'illustration', 'untitled', 'ছবি', 'চিত্র', 'স্ক্রিনশট', 'স্ক্রীনশট', 'ডায়াগ্রাম', 'আইকন',
]);
const FILE_NAME = /\.(png|jpe?g|gif|svg|webp)$/i;
const stripCode = (s) => s.replace(/```[\s\S]*?```/g, '').replace(/`[^`\n]*`/g, '');

/** Why `alt` is not meaningful, or null when it is. */
export function altProblem(alt) {
  const text = (alt ?? '').trim();
  if (!text) return 'empty';
  const words = text
    .toLowerCase()
    .replace(/[\s\-_:.]+/g, ' ')
    .replace(/\s*\d+\s*$/, '')
    .trim();
  if (GENERIC.has(words)) return `generic ("${text}")`;
  if (FILE_NAME.test(text)) return `a file name ("${text}")`;
  return null;
}

/** Every image of one page body → [{ src, alt }]; `alt` is null when the attribute is missing. */
export function imagesIn(body) {
  const text = stripCode(body);
  const out = [];
  for (const m of text.matchAll(/!\[([^\]]*)\]\(([^)\s]+)[^)]*\)/g)) out.push({ alt: m[1], src: m[2] });
  for (const m of text.matchAll(/<img\b[^>]*>/gi)) {
    const tag = m[0];
    const alt = tag.match(/\balt\s*=\s*(?:"([^"]*)"|'([^']*)')/i);
    const src = tag.match(/\bsrc\s*=\s*(?:"([^"]*)"|'([^']*)')/i);
    out.push({ alt: alt ? (alt[1] ?? alt[2]) : null, src: src ? (src[1] ?? src[2]) : '?' });
  }
  return out;
}

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    if (name === '_generated' || name === '_diagrams') continue;
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (name.endsWith('.md')) out.push(full);
  }
  return out;
}

/** → [{ file, problem }] for every image without meaningful alt text under docs/user-guide. */
export function checkAltText(root = '.') {
  const guide = path.join(root, 'docs/user-guide');
  const problems = [];
  if (!existsSync(guide)) return problems;
  for (const file of walk(guide)) {
    for (const { alt, src } of imagesIn(readFileSync(file, 'utf8'))) {
      const why = alt === null ? 'missing' : altProblem(alt);
      if (why) problems.push({ file: path.relative(root, file), problem: `(s) image ${src} has no meaningful alt text: ${why}` });
    }
  }
  return problems;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const problems = checkAltText(process.argv[2] ?? '.');
  for (const p of problems) console.log(JSON.stringify(p));
  process.exit(problems.length ? 1 : 0);
}

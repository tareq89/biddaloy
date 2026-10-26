#!/usr/bin/env node
// [Epic 42] Renders docs/user-guide/_diagrams/<name>.<lang>.mmd to
// docs/user-guide/<lang>/<section>/diagrams/<name>.svg (D23, D29).
//
//   node scripts/user-guide/render-diagrams.mjs [name-prefix]
//
// The section is the longest existing section folder that prefixes <name>
// ("attendance-daily" → attendance/, "exams-results-marks" → exams-results/); else the part before the first "-".
// Each svg gets <title>/<desc> from the `%% title:` / `%% desc:` lines and a
// `<!-- src:<sha1> -->` stamp of its source, so a check can tell a stale svg.
// Needs mmdc: `MMDC` env (a path), else the devDependency's node_modules/.bin/mmdc,
// else `npx -p @mermaid-js/mermaid-cli mmdc`.
// `PUPPETEER_CONFIG` may point mmdc at an installed Chrome.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const SRC = 'docs/user-guide/_diagrams';
const THEME = 'docs/documentation/diagram-theme.json';
const prefix = process.argv[2] ?? '';

const escapeXml = (s) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function mmdc(args) {
  const extra = process.env.PUPPETEER_CONFIG ? ['-p', process.env.PUPPETEER_CONFIG] : [];
  const local =
    process.env.MMDC ?? (existsSync('node_modules/.bin/mmdc') ? 'node_modules/.bin/mmdc' : '');
  if (local) return execFileSync(local, [...args, ...extra], { stdio: 'inherit' });
  return execFileSync(
    'npx',
    ['-y', '-p', '@mermaid-js/mermaid-cli@11', 'mmdc', ...args, ...extra],
    {
      stdio: 'inherit',
    },
  );
}

const files = readdirSync(SRC).filter((f) => /\.(bn|en)\.mmd$/.test(f) && f.startsWith(prefix));
function sectionOf(lang, name) {
  const dirs = readdirSync(path.join('docs/user-guide', lang), { withFileTypes: true })
    .filter((d) => d.isDirectory() && (name === d.name || name.startsWith(`${d.name}-`)))
    .map((d) => d.name)
    .sort((a, b) => b.length - a.length);
  return dirs[0] ?? name.split('-')[0];
}

for (const file of files) {
  const [, name, lang] = file.match(/^(.+)\.(bn|en)\.mmd$/);
  const source = readFileSync(path.join(SRC, file), 'utf8');
  const title = source.match(/^%% title: (.+)$/m)?.[1] ?? name;
  const desc = source.match(/^%% desc: (.+)$/m)?.[1] ?? '';
  const outDir = path.join('docs/user-guide', lang, sectionOf(lang, name), 'diagrams');
  mkdirSync(outDir, { recursive: true });
  const out = path.join(outDir, `${name}.svg`);
  mmdc(['-i', path.join(SRC, file), '-o', out, '-c', THEME, '-b', 'transparent', '-q']);
  const sha = createHash('sha1').update(source).digest('hex');
  const svg = readFileSync(out, 'utf8')
    .replace(/<title>[\s\S]*?<\/title>|<desc>[\s\S]*?<\/desc>/g, '')
    .replace(/<svg\b([^>]*)>/, (open, attrs) => {
      // mmdc writes width="100%" + a max-width style. As an <img> that has no
      // intrinsic size, so GitHub stretches a 180 px diagram to the full column.
      // Pin the real size from the viewBox instead.
      const [, w, h] = attrs.match(/viewBox="[\d.]+ [\d.]+ ([\d.]+) ([\d.]+)"/) ?? [];
      const sized = attrs
        .replace(/\s(?:aria-[a-z]+|role|width|height)="[^"]*"/g, '')
        .replace(/max-width:[^;"]*;?\s*/, '');
      return (
        `<svg${sized} width="${Math.ceil(w)}" height="${Math.ceil(h)}" role="img" aria-labelledby="t d">` +
        `<title id="t">${escapeXml(title)}</title><desc id="d">${escapeXml(desc)}</desc>`
      );
    });
  writeFileSync(out, `<!-- src:${sha} -->\n${svg}`);
  console.log(`${file} -> ${out}`);
}

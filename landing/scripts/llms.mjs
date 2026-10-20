#!/usr/bin/env node
// [50.13] Writes dist/llms.txt (the llmstxt.org format) from the built English pages:
// each page's <title> and meta description. Runs after `astro build`, so it cannot drift from the site.
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const dist = resolve(dirname(fileURLToPath(import.meta.url)), '../dist');
const site = 'https://schoolmanagerp.com';

const pages = (dir) =>
  readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? pages(p) : n === 'index.html' ? [p] : [];
  });
const pick = (html, re) =>
  (html.match(re)?.[1] ?? '')
    .replace(/&amp;/g, '&')
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"');

const lines = pages(join(dist, 'en'))
  .sort()
  .map((file) => [file, readFileSync(file, 'utf8')])
  .filter(([, html]) => !html.includes('name="robots" content="noindex"')) // keep unlisted pages (testimonials) out
  .map(([file, html]) => {
    const url = `${site}/${relative(dist, dirname(file))}/`;
    const esc = (x) => x.replace(/([[\]])/g, '\\$1');
    const title = esc(pick(html, /<title>([^<]*)<\/title>/));
    const desc = pick(html, /<meta name="description" content="([^"]*)"/);
    return `- [${title}](${url}): ${desc}`;
  });

writeFileSync(
  join(dist, 'llms.txt'),
  `# SchoolManager ERP\n\n> School management software for schools, colleges and madrasas in Bangladesh. ৳10 per student per month. Bangla and English: every page exists at /bn/ and /en/.\n\n## Pages\n\n${lines.join('\n')}\n`,
);
console.log(`llms.txt: ${lines.length} pages`);

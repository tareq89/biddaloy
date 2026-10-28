#!/usr/bin/env node
// [Epic 42] Fills pending-image comments from e2e/docs/tours/shot-plan.json: the idx-th pending
// comment of a page becomes the image `<section>/img/<page>-<idx+1>.png` when that file exists.
// Run it once per plan, right after the shots, before any comment is removed (idx counts all of them).
//   node scripts/user-guide/fill-plan.mjs [section ...]
import { existsSync, readFileSync, writeFileSync } from 'node:fs';

const plan = JSON.parse(readFileSync('e2e/docs/tours/shot-plan.json', 'utf8'));
const only = process.argv.slice(2);
const RE = /<!-- image pending: ([^\n]*?) -->/g;
// The shots carry no numbered marks, so the alt text must not say "marked".
const clean = (t) =>
  t
    .replace(/,\s*(desktop|phone)$/, '')
    .replace(/,\s*[^,]*$/, (m) => (/(admin|teacher|office|committee|coordinator|অ্যাডমিন|শিক্ষক|Admin)/i.test(m) ? '' : m))
    .replace(/\s*(marked with numbers|marked|numbered|নম্বর দিয়ে চিহ্নিত|চিহ্নিত)/g, '')
    .replace(/^img\/\S+ (\(width \d+\) )?— /, '')
    .replace(/"/g, '&quot;')
    .replace(/[,\s]+$/, '');
let n = 0;
for (const [page, entries] of Object.entries(plan)) {
  if (only.length && !only.includes(page.split('/')[0])) continue;
  const [sec, slug] = page.split('/');
  for (const lang of ['bn', 'en']) {
    const file = `docs/user-guide/${lang}/${page}.md`;
    let i = -1;
    const src = readFileSync(file, 'utf8');
    const total = [...src.matchAll(RE)].length;
    if (total !== entries.length) {
      console.log(`skip ${lang}/${page}: ${total} pending, plan has ${entries.length}`);
      continue;
    }
    const next = src.replace(RE, (whole, text) => {
      i += 1;
      const e = entries[i];
      const name = `${slug}-${String(i + 1).padStart(2, '0')}.png`;
      if (e.kind === 'skip' || !existsSync(`docs/user-guide/${lang}/${sec}/img/${name}`)) return whole;
      n += 1;
      const alt = clean(text);
      return e.phone
        ? `<img src="img/${name}" alt="${alt}" width="300">`
        : `![${alt.replace(/[[\]]/g, '')}](img/${name})`;
    });
    writeFileSync(file, next);
  }
}
console.log(`filled ${n}`);

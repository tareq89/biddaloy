#!/usr/bin/env node
// [Epic 42] Replaces `<!-- image pending: img/<file>.png [(width N)] — <alt> -->` with the real
// image once the PNG exists next to the page. Pending comments with no file name, or whose file
// is missing, are left alone.
//
//   node scripts/user-guide/fill-images.mjs [rootDir]     prints how many were filled
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const root = process.argv[2] ?? 'docs/user-guide';
const RE = /<!-- image pending: (img\/[\w.-]+\.png)(?: \(width (\d+)\))? [—-] ([^\n]*?) -->/g;

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    if (name === '_generated' || name === '_diagrams' || name === 'img') continue;
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (name.endsWith('.md')) out.push(full);
  }
  return out;
}

let filled = 0;
for (const file of walk(root)) {
  const src = readFileSync(file, 'utf8');
  const next = src.replace(RE, (whole, img, width, alt) => {
    if (!existsSync(path.join(path.dirname(file), img))) return whole;
    filled += 1;
    const text = alt.replace(/"/g, '&quot;').trim();
    return width
      ? `<img src="${img}" alt="${text}" width="${width}">`
      : `![${text.replace(/[[\]]/g, '')}](${img})`;
  });
  if (next !== src) writeFileSync(file, next);
}
console.log(`filled ${filled}`);

#!/usr/bin/env node
/**
 * Composes the bundle-size delta PR comment (#150).
 *
 * Usage: node scripts/bundle-delta.mjs <base-report.json> <pr-report.json> <out.md>
 *
 * Both inputs are `route-chunks-report.json` files emitted by
 * `client-admin/scripts/check-route-chunks.mjs`. Chunk file names carry a
 * content hash (`dues-Bf3k2.js`), so chunks are matched across builds by
 * their hashless stem (`dues.js`). If the base report is missing (first run
 * on a repo with no successful main build yet), the comment says so and
 * shows absolute PR numbers only.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';

const [basePath, prPath, outPath] = process.argv.slice(2);
if (!prPath || !outPath) {
  console.error('usage: bundle-delta.mjs <base-report.json> <pr-report.json> <out.md>');
  process.exit(1);
}

const stem = (file) => file.replace(/-[^-.]+\.js$/, '.js');
const kb = (bytes) => `${(bytes / 1024).toFixed(1)} KB`;
const signed = (delta) => (delta >= 0 ? `+${kb(delta)}` : `-${kb(-delta)}`);

const pr = JSON.parse(readFileSync(prPath, 'utf8'));
const lines = ['### Bundle size delta', ''];

if (!basePath || !existsSync(basePath)) {
  lines.push('_No baseline report from `main` yet — absolute sizes only._', '');
  lines.push(
    `Entry chunk \`${pr.entry.file}\`: **${kb(pr.entry.gzipBytes)}** gzipped ` +
      `(ceiling ${kb(pr.entry.ceilingBytes)}, headroom ${kb(pr.entry.ceilingBytes - pr.entry.gzipBytes)})`,
  );
} else {
  const base = JSON.parse(readFileSync(basePath, 'utf8'));
  const entryDelta = pr.entry.gzipBytes - base.entry.gzipBytes;
  lines.push(
    `Entry chunk: ${kb(base.entry.gzipBytes)} → **${kb(pr.entry.gzipBytes)}** gzipped ` +
      `(${signed(entryDelta)}, headroom ${kb(pr.entry.ceilingBytes - pr.entry.gzipBytes)} ` +
      `under the ${kb(pr.entry.ceilingBytes)} ceiling)`,
    '',
  );

  // Several route directories emit chunks with the same hashless stem
  // (every `index.tsx` route produces an `index-<hash>.js`), so stems are
  // aggregated: same-named chunks sum into one row per build.
  const byStem = (chunks) => {
    const m = new Map();
    for (const c of chunks) {
      const name = stem(c.file);
      m.set(name, (m.get(name) ?? 0) + c.gzipBytes);
    }
    return m;
  };
  const baseByStem = byStem(base.chunks);
  const prByStem = byStem(pr.chunks);
  const rows = [];
  for (const [name, bytes] of prByStem) {
    const b = baseByStem.get(name);
    rows.push({
      name,
      base: b ?? null,
      pr: bytes,
      delta: bytes - (b ?? 0),
      status: b === undefined ? 'added' : '',
    });
  }
  for (const [name, b] of baseByStem) {
    if (!prByStem.has(name)) {
      rows.push({ name, base: b, pr: null, delta: -b, status: 'removed' });
    }
  }

  // Top 10 by absolute change, but always keep added/removed chunks visible.
  const shown = rows
    .filter((r) => r.status !== '' || r.delta !== 0)
    .sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta))
    .filter((r, i) => r.status !== '' || i < 10);

  if (shown.length === 0) {
    lines.push('No per-chunk changes.');
  } else {
    lines.push('| Chunk | Base | PR | Δ gzip |', '|---|---|---|---|');
    for (const r of shown) {
      lines.push(
        `| \`${r.name}\`${r.status ? ` _(${r.status})_` : ''} ` +
          `| ${r.base === null ? '—' : kb(r.base)} ` +
          `| ${r.pr === null ? '—' : kb(r.pr)} ` +
          `| ${signed(r.delta)} |`,
      );
    }
  }

  const totalBase = base.chunks.reduce((sum, c) => sum + c.gzipBytes, 0);
  const totalPr = pr.chunks.reduce((sum, c) => sum + c.gzipBytes, 0);
  lines.push(
    '',
    `Total across all JS chunks: ${kb(totalBase)} → ${kb(totalPr)} (${signed(totalPr - totalBase)})`,
  );
}

writeFileSync(outPath, lines.join('\n') + '\n');
console.log(`Wrote ${outPath}`);

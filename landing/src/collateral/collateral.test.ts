import { execFileSync } from 'node:child_process';
import { readFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test } from 'vitest';

const root = join(dirname(fileURLToPath(import.meta.url)), '../..');

// Runs the real script (needs a Playwright Chromium); it also fails itself on page count / size.
test('collateral: 1-page PDF and 1080x1080 PNG', () => {
  execFileSync('node', ['scripts/build-collateral.mjs'], { cwd: root, stdio: 'pipe' });
  const pdf = readFileSync(join(root, 'dist/sm-ek-pata.pdf'), 'latin1');
  expect(pdf.match(/\/Type\s*\/Page(?![s\w])/g)).toHaveLength(1);
  expect(statSync(join(root, 'dist/sm-ek-pata.pdf')).size).toBeLessThan(300 * 1024);
  const png = readFileSync(join(root, 'dist/sm-whatsapp.png'));
  expect([png.readUInt32BE(16), png.readUInt32BE(20)]).toEqual([1080, 1080]);
}, 60_000);

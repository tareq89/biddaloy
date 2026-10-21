#!/usr/bin/env node
// [50.2] Drift guard: landing tokens that mirror the app (radius, motion) must
// exist in ui/src/styles/globals.css with the same value. Landing-only tokens
// (v5 mockup palette) are listed explicitly below; anything else fails.
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const landingCss = readFileSync(resolve(root, 'landing/src/styles/tokens.css'), 'utf8');
const appCss = readFileSync(resolve(root, 'ui/src/styles/globals.css'), 'utf8');

const LANDING_ONLY = new Set([
  '--bg', '--surface', '--surface-2', '--fg', '--muted', '--line', '--ink', '--ink-fg',
  '--indigo', '--indigo-t', '--teal', '--teal-t', '--amber', '--amber-t', '--coral', '--coral-t',
  '--brand', '--shot', '--shot-ink', '--font', '--hue', '--hue-ink', '--tint',
  '--teal-ink', '--amber-ink', '--coral-ink',
]);

const decls = (css) => {
  const map = new Map();
  for (const [, name, value] of css.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) {
    if (!map.has(name)) map.set(name, value.trim());
  }
  return map;
};
const landing = decls(landingCss);
const app = decls(appCss);

const errors = [];
for (const [name, value] of landing) {
  if (LANDING_ONLY.has(name)) continue;
  if (!app.has(name)) {
    errors.push(`${name} is not in ui/src/styles/globals.css (add to LANDING_ONLY if landing-only)`);
  } else if (app.get(name) !== value) {
    errors.push(`${name}: landing "${value}" != app "${app.get(name)}"`);
  }
}
if (errors.length) {
  console.error(`landing token drift:\n  ${errors.join('\n  ')}`);
  process.exit(1);
}
console.log(`landing tokens ok (${landing.size} found, ${LANDING_ONLY.size} landing-only allowed)`);

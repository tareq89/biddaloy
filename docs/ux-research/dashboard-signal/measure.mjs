#!/usr/bin/env node
// AI-simulated check, NOT real users. Run: node .claude/skills/redesign-page/scripts/shoot.mjs
// docs/ux-research/dashboard-signal/mockup.html  (writes _render.html), then
// node docs/ux-research/dashboard-signal/measure.mjs
// Measures objective facts about the mockup only: marker counts, icon + sr-only text,
// signal contrast against the card, and whether every critical card is above the fold.
import { chromium } from '@playwright/test';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const dir = dirname(fileURLToPath(import.meta.url));
const url = pathToFileURL(resolve(dir, '_render.html')).href;
const VIEWS = { desktop: [1440, 900], mobile: [390, 844] };

const browser = await chromium.launch();
const out = {};
for (const [name, [width, height]] of Object.entries(VIEWS)) {
  const page = await browser.newPage({ viewport: { width, height } });
  await page.goto(url);
  await page.waitForTimeout(1500); // Tailwind CDN compiles in the browser
  out[name] = await page.evaluate(({ grid, height }) => {
    const rgb = (c) => {
      const x = document.createElement('canvas').getContext('2d');
      x.fillStyle = c;
      x.fillRect(0, 0, 1, 1);
      return [...x.getImageData(0, 0, 1, 1).data].slice(0, 3);
    };
    const lum = ([r, g, b]) =>
      [r, g, b]
        .map((v) => ((v /= 255) <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4))
        .reduce((a, v, i) => a + v * [0.2126, 0.7152, 0.0722][i], 0);
    const ratio = (a, b) => {
      const [hi, lo] = [lum(a), lum(b)].sort((p, q) => q - p);
      return (hi + 0.05) / (lo + 0.05);
    };
    const root = document.querySelector(`[data-testid="${grid}"]`);
    const res = { levels: {}, markers: 0, markersWithIconAndText: 0, minContrast: 99, criticalBelowFold: 0 };
    for (const card of root.querySelectorAll('[data-card]')) {
      const m = card.querySelector('[data-signal]');
      const lvl = m.dataset.signal;
      res.levels[lvl] = (res.levels[lvl] || 0) + 1;
      res.markers++;
      const icon = m.querySelector('svg[aria-hidden="true"]');
      const txt = m.querySelector('.sr-only')?.textContent.trim();
      if (icon && txt) res.markersWithIconAndText++;
      const bg = rgb(getComputedStyle(card).backgroundColor);
      res.minContrast = Math.min(res.minContrast, ratio(rgb(getComputedStyle(m).color), bg));
      if (lvl === 'critical' && card.getBoundingClientRect().bottom > height) res.criticalBelowFold++;
    }
    res.minContrast = Math.round(res.minContrast * 100) / 100;
    return res;
  }, { grid: name === 'desktop' ? 'grid-desktop' : 'grid-mobile', height });
  await page.close();
}
await browser.close();
console.log(JSON.stringify({ note: 'AI-simulated, not real users', ...out }, null, 2));

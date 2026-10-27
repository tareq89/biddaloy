#!/usr/bin/env node
// [Epic 42] Fills description-only `<!-- image pending: ... -->` comments from a fixed
// page -> [comment-order index, image] map, when the PNG exists. Same order in bn and en.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';

const MAP = {
  'dashboard/dashboard.md': {
    0: 'dashboard-01-admin', 1: 'dashboard-01-admin', 2: 'dashboard-01-teacher',
    3: 'dashboard-01-accountant', 4: 'dashboard-01-office', 5: 'dashboard-01-exam',
    6: 'dashboard-01-committee', 7: 'dashboard-phone-01-teacher',
  },
  'dashboard/customise.md': { 0: 'dashboard-02-customise', 2: 'dashboard-02-customise-phone' },
  'dashboard/alerts.md': { 1: 'dashboard-alerts-01-todo', 2: 'dashboard-03-settings' },
};
const RE = /<!-- image pending: ([^\n]*?) -->/g;
let n = 0;
for (const lang of ['bn', 'en']) {
  for (const [page, byIdx] of Object.entries(MAP)) {
    const dir = `docs/user-guide/${lang}/${page.split('/')[0]}`;
    const file = `docs/user-guide/${lang}/${page}`;
    let i = -1;
    const next = readFileSync(file, 'utf8').replace(RE, (whole, text) => {
      i += 1;
      const name = byIdx[i];
      if (!name || !existsSync(`${dir}/img/${name}.png`)) return whole;
      n += 1;
      const phone = /phone$/.test(text);
      const alt = text.replace(/,\s*(desktop|phone)$/, '').replace(/"/g, '&quot;');
      return `<img src="img/${name}.png" alt="${alt}"${phone ? ' width="300"' : ''}>`;
    });
    writeFileSync(file, next);
  }
}
console.log(`filled ${n}`);

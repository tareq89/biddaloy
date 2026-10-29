#!/usr/bin/env node
/**
 * [Epic 42 / #2556] One-page A4 "desk card" per role and language, printed to PDF
 * with Playwright's page.pdf() (D48: PDFs are fine, video is not).
 *
 * The card reads the role page's "#tasks" list, so the page stays the only source:
 *   1. **[Task name](../people/students.md#task-main)** — one-line step.
 *
 *   node scripts/user-guide/quick-card.mjs [role-kebab]
 *   GUIDE_BASE_URL=https://help.example.com  -> prints that address as the page link;
 *   unset -> prints the Help Center path instead (no public address exists yet).
 *   CHROME_PATH=/path/to/chrome              -> browser for page.pdf (default: Playwright's Chromium)
 *
 * Output: docs/user-guide/<lang>/roles/cards/<role>.<lang>.pdf, at most 300 KB each.
 */
import { mkdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

export const ROLES = [
  'headmaster',
  'admin',
  'accountant',
  'teacher',
  'office-staff',
  'exam-controller',
  'committee',
  'guardian',
  'student',
];
export const LANGS = ['bn', 'en'];
export const MAX_BYTES = 300 * 1024;

const TEXT = {
  bn: { tasks: 'আপনার ৫টি সাধারণ কাজ', page: 'গাইড পাতা', help: 'SchoolManager সহায়তা কেন্দ্র › ভূমিকা', brand: 'SchoolManager' },
  en: { tasks: 'Your 5 most common tasks', page: 'Guide page', help: 'SchoolManager Help Center › Roles', brand: 'SchoolManager' },
};

const esc = (s) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** H1 of a role page. */
export const parseTitle = (md) => md.match(/^# (.+)$/m)?.[1].trim() ?? '';

/** The `#tasks` list: [{ name, step }] in order. Throws unless it has exactly 5 items. */
export function parseTasks(md) {
  const at = md.search(/^##[^\n]*(?<![\w-])id="tasks"/m);
  if (at < 0) throw new Error('no #tasks heading');
  const rest = md.slice(at).split('\n').slice(1);
  const end = rest.findIndex((l) => /^#{1,6} /.test(l));
  const section = (end < 0 ? rest : rest.slice(0, end)).join('\n');
  const tasks = [...section.matchAll(/^\d+\.\s+\*\*\[([^\]]+)\]\([^)]*\)\*\*\s*[—-]\s*(.+)$/gm)].map((m) => ({
    name: m[1].trim(),
    step: m[2].trim(),
  }));
  if (tasks.length !== 5) throw new Error(`#tasks has ${tasks.length} items, want 5`);
  return tasks;
}

/** Small self-contained HTML for one card. */
export function cardHtml({ lang, role, title, tasks, base }) {
  const t = TEXT[lang];
  const where = base ? `${base.replace(/\/$/, '')}/${lang}/roles/${role}` : `${t.help} › ${title}`;
  const rows = tasks
    .map(
      (k, i) =>
        `<li><span class="n">${i + 1}</span><div><b>${esc(k.name)}</b><p>${esc(k.step)}</p></div></li>`,
    )
    .join('');
  return `<!doctype html><html lang="${lang}"><head><meta charset="utf-8"><title>${esc(title)}</title><style>
@page{size:A4;margin:0}
*{box-sizing:border-box}
body{margin:0;padding:18mm 16mm;font:15px/1.45 system-ui,"Noto Sans Bengali","Bangla Sangam MN",sans-serif;color:#111}
.brand{font-weight:700;letter-spacing:.04em;color:#1a56db;font-size:18px}
h1{font-size:30px;margin:6px 0 4px}
h2{font-size:16px;margin:18px 0 8px;color:#444;border-bottom:2px solid #1a56db;padding-bottom:4px}
ol{list-style:none;margin:0;padding:0}
li{display:flex;gap:12px;align-items:flex-start;margin:0 0 12px;padding:10px 12px;border:1px solid #cbd5e1;border-radius:8px}
.n{flex:none;width:30px;height:30px;border-radius:50%;background:#1a56db;color:#fff;text-align:center;line-height:30px;font-weight:700}
b{font-size:17px}
p{margin:2px 0 0;color:#333}
.foot{margin-top:18px;padding-top:10px;border-top:1px solid #cbd5e1;font-size:13px;color:#444;word-break:break-all}
</style></head><body>
<div class="brand">${t.brand}</div>
<h1>${esc(title)}</h1>
<h2>${t.tasks}</h2>
<ol>${rows}</ol>
<div class="foot">${t.page}: ${esc(where)}</div>
</body></html>`;
}

/** Prints the card of one role and language; returns the PDF path. */
export async function makeCard({ root = '.', role, lang, out, base = process.env.GUIDE_BASE_URL, browser }) {
  const md = readFileSync(path.join(root, `docs/user-guide/${lang}/roles/${role}.md`), 'utf8');
  const html = cardHtml({ lang, role, title: parseTitle(md), tasks: parseTasks(md), base });
  const file = out ?? path.join(root, `docs/user-guide/${lang}/roles/cards/${role}.${lang}.pdf`);
  mkdirSync(path.dirname(file), { recursive: true });
  const page = await browser.newPage();
  await page.setContent(html);
  await page.pdf({ path: file, format: 'A4', printBackground: true, pageRanges: '1' });
  await page.close();
  const size = statSync(file).size;
  if (size > MAX_BYTES) throw new Error(`${file} is ${size} bytes, limit ${MAX_BYTES}`);
  return file;
}

export async function launch() {
  const { chromium } = await import('playwright-core');
  return chromium.launch(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {});
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const only = process.argv[2];
  const browser = await launch();
  try {
    for (const role of only ? [only] : ROLES)
      for (const lang of LANGS) console.log(await makeCard({ role, lang, browser }));
  } finally {
    await browser.close();
  }
}

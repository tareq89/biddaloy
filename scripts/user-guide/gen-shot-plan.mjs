#!/usr/bin/env node
// [Epic 42] Builds e2e/docs/tours/shot-plan.json from the pending-image comments of the
// en pages (same order in bn). One entry per pending comment: a page shot, a dialog shot
// (first primary button clicked), or skip.
//   node scripts/user-guide/gen-shot-plan.mjs people academics attendance
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';

const features = JSON.parse(readFileSync('docs/user-guide/_generated/features.json', 'utf8'));
const CARD = {
  admin: 'admin', Admin: 'admin', teacher: 'class-teacher-8a', 'office staff': 'office-staff',
  committee: 'committee', 'academic coordinator': 'admin', 'অ্যাডমিন': 'admin', 'শিক্ষক': 'class-teacher-8a',
};
const plan = {};
for (const sec of process.argv.slice(2)) {
  for (const f of readdirSync(`docs/user-guide/en/${sec}`).filter((n) => n.endsWith('.md'))) {
    const page = `${sec}/${f.slice(0, -3)}`;
    const feat = features.find((x) => x.path === page);
    if (!feat) continue;
    const txt = readFileSync(`docs/user-guide/en/${page}.md`, 'utf8');
    const out = [];
    let i = -1;
    for (const m of txt.matchAll(/<!-- image pending: ([^\n]*?) -->/g)) {
      i += 1;
      const t = m[1].replace(/^img\/\S+ (\(width \d+\) )?— /, '');
      const parts = t.split(',').map((s) => s.trim());
      const device = parts.at(-1);
      const role = parts.at(-2) ?? '';
      const bangla = /[ঀ-৿]/.test(t);
      let kind = 'page';
      if (/GIF/.test(t) || /guest/.test(role)) kind = 'skip';
      else if (!bangla && /dialog|Add .*form|Create homework|Enrol|Record achievement|Add event/i.test(t) && !/Assign teacher|Request a change/.test(t)) kind = 'dialog';
      else if (!bangla && /preview|Rows with problems|Request a change|Reported state|Edit guardian|row in the list|criteria step|section card, three|application page|program page|profile|Assign teacher dialog|Assign a period|Period times|Sections tab|Study plans|study plan page|survey form/i.test(t)) kind = 'skip';
      else if (bangla && /সম্পাদনা চলছে/.test(t)) kind = 'skip';
      let route = feat.route;
      if (/Add student form/.test(t)) { route = '/students/new'; kind = 'page'; }
      if (/Student profile/.test(t)) { kind = 'row'; }
      if (page === 'academics/routine-builder') kind = /Assign a period/.test(t) ? 'skip' : 'row';
      if (route === '/academics/syllabus') kind = 'skip'; // demo class 10 has no topics: pending
      if (kind === 'page' && ['/attendance/register'].includes(route)) kind = 'pick';
      out.push({ idx: i, kind, login: CARD[role] ?? 'admin', phone: device === 'phone', text: parts.slice(0, -2).join(', ') || t, route });
    }
    if (out.length) plan[page] = out;
  }
}
writeFileSync('e2e/docs/tours/shot-plan.json', JSON.stringify(plan, null, 1));
console.log(Object.keys(plan).length, 'pages;', Object.values(plan).flat().filter((e) => e.kind !== 'skip').length, 'shots');

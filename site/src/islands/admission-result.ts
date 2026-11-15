// Admission lookup island (Epic 71, #4192): status, result + admit card, published lists.
// Copy comes from `data-t` (admission.lookup.*); the server's own text is never shown (Rule 23).
// Everything goes in as text, never markup. No captcha: the by-host routes are throttled server-side.
import {
  fetchAdmitCard,
  fetchLists,
  fetchResult,
  fetchStatus,
  type AdmitCardData,
  type Lookup,
  type PublishedList,
  type ResultData,
} from '../lib/admission';

type Dict = Record<string, string>;
const fill = (s: string, v: Record<string, string | number>) =>
  s.replace(/\{(\w+)\}/g, (_, k: string) => String(v[k] ?? ''));

function el<K extends keyof HTMLElementTagNameMap>(tag: K, props: Record<string, unknown>, kids: (Node | string)[] = []) {
  const n = Object.assign(document.createElement(tag), props);
  n.append(...kids);
  return n;
}

/** The one sentence for a failed lookup; a wrong roll and a wrong phone share it. */
export const failText = (k: 'miss' | 'rate' | 'down' | 'error', t: Dict) => t[k];

const listName = (kind: string, seq: number, t: Dict) =>
  kind === 'MERIT' ? t.listMerit : kind === 'WAITING' ? fill(t.listWaiting, { seq }) : t.listCall;

/** Published parts only: stages with a published outcome, list places the round published. */
export function renderResult(d: ResultData, t: Dict): HTMLElement {
  const box = el('div', { className: 'adm-out' }, [
    el('p', {}, [fill(t.statusLine, { name: d.applicant_name, status: t[`status.${d.status}`] ?? '' })]),
  ]);
  if (d.stages.length) {
    box.append(
      el('h2', {}, [t.stages]),
      el('ul', {}, d.stages.map((s) => el('li', {}, [`${s.title}: ${s.outcome === 'PASSED' ? t.passed : t.notPassed}`]))),
    );
  }
  for (const l of d.lists) {
    const line = l.kind === 'WAITING' ? fill(t.waiting, { n: l.position, seq: l.sequence }) : fill(t.merit, { n: l.position });
    box.append(el('p', {}, [line + (l.act_by_date ? ` ${fill(t.deadline, { date: l.act_by_date })}` : '')]));
  }
  if (!d.stages.length && !d.lists.length) box.append(el('p', {}, [t.noStage]));
  return box;
}

/** The print block: roll, round, then each scheduled stage's date, time and place; a blank photo box. */
export function renderAdmitCard(d: AdmitCardData, t: Dict): HTMLElement {
  const row = (k: string, v: string | null) => el('p', {}, [el('strong', {}, [`${k}: `]), v ?? '']);
  return el('section', { className: 'adm-card', ariaLabel: t.admitTitle }, [
    el('h2', {}, [t.admitTitle]),
    el('div', { className: 'adm-photo' }, [t.admitPhoto]),
    row(t.roll, d.roll_number),
    row(t.admitName, d.applicant_name),
    row(t.admitGuardian, d.guardian_name),
    row(t.admitDob, d.date_of_birth),
    row(t.admitRound, d.intake_title),
    ...(d.schedule.length
      ? d.schedule.map((s) => row(s.title, [s.date, s.start_time, s.venue].filter(Boolean).join(' · ')))
      : [el('p', {}, [t.admitNone])]),
  ]);
}

/** Roll numbers only, grouped by list. A name shows only when the server sent one (school opted in). */
export function renderLists(lists: PublishedList[], t: Dict): HTMLElement {
  const box = el('div', { className: 'adm-out' });
  for (const l of lists) {
    box.append(
      el('h2', {}, [`${l.intake_title} — ${listName(l.kind, l.sequence, t)}`]),
      ...(l.act_by_date ? [el('p', {}, [fill(t.deadline, { date: l.act_by_date })])] : []),
      el('ol', { className: 'adm-roll' }, l.members.map((m) =>
        el('li', {}, [[m.roll_number ?? '', m.applicant_name].filter(Boolean).join(' ')]))),
    );
  }
  return box;
}

export interface Deps { fetchImpl?: typeof fetch; print?: () => void }

/** Wire one page. Returns nothing; tests drive it through the DOM. */
export async function mountLookup(root: HTMLElement, t: Dict, deps: Deps = {}) {
  const f = deps.fetchImpl ?? fetch;
  const print = deps.print ?? (() => window.print());
  const mode = root.dataset.mode;
  const out = root.querySelector<HTMLElement>('[data-out]')!;
  const status = root.querySelector<HTMLElement>('[data-status]')!;
  const say = (m: string) => (status.textContent = m);
  const fail = (r: Exclude<Lookup<unknown>, { kind: 'ok' }>) => {
    out.replaceChildren();
    say(failText(r.kind, t));
  };

  if (mode === 'lists') {
    const r = await fetchLists(f);
    if (r.kind !== 'ok') return fail(r);
    if (!r.data.length) return say(t.noLists);
    out.replaceChildren(renderLists(r.data, t));
    return;
  }

  const form = root.querySelector<HTMLFormElement>('form')!;
  const val = (n: string) => (form.elements.namedItem(n) as HTMLInputElement).value;
  form.addEventListener('submit', async (e) => {
    e.preventDefault(); // never the browser's GET: a phone number must not reach the URL
    say(t.showing);
    out.replaceChildren();
    if (mode === 'status') {
      const r = await fetchStatus(val('reference'), val('phone'), f);
      if (r.kind !== 'ok') return fail(r);
      say('');
      out.append(el('p', {}, [fill(t.statusLine, { name: r.data.applicant_name, status: t[`status.${r.data.status}`] ?? '' })]));
      return;
    }
    const r = await fetchResult(val('roll'), val('phone'), f);
    if (r.kind !== 'ok') return fail(r);
    say('');
    out.append(renderResult(r.data, t));
    const btn = el('button', { type: 'button', className: 'btn btn-ghost' }, [t.admitCard]);
    btn.addEventListener('click', async () => {
      const c = await fetchAdmitCard(val('roll'), val('phone'), f);
      if (c.kind !== 'ok') return fail(c);
      out.querySelector('.adm-card')?.remove();
      out.append(renderAdmitCard(c.data, t));
      print();
    });
    out.append(btn);
  });
}

if (typeof document !== 'undefined') {
  document.querySelectorAll<HTMLElement>('[data-adm-lookup]').forEach((r) => void mountLookup(r, JSON.parse(r.dataset.t ?? '{}')));
}

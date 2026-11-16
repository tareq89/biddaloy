// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { mountLookup, renderAdmitCard, renderLists, renderResult } from './admission-result';
import { fetchResult } from '../lib/admission';
import bn from '../i18n/bn.json';
import en from '../i18n/en.json';

const flat = (o: Record<string, unknown>, p = ''): Record<string, string> =>
  Object.fromEntries(
    Object.entries(o).flatMap(([k, v]) =>
      typeof v === 'string' ? [[p + k, v]] : Object.entries(flat(v as Record<string, unknown>, `${p}${k}.`)),
    ),
  );
const T = flat(bn.admission.lookup);
const json = (status: number, body: unknown = {}) => new Response(JSON.stringify(body), { status });
const page = (mode: string) => {
  document.body.innerHTML = `<div data-mode="${mode}"><form><input name="roll" value="১২"/><input name="phone" value="01711111111"/></form><p data-status></p><div data-out></div></div>`;
  return document.body.firstElementChild as HTMLElement;
};
const submit = async (root: HTMLElement) => {
  root.querySelector('form')!.dispatchEvent(new Event('submit', { cancelable: true }));
  await vi.waitFor(() => expect(root.querySelector('[data-status]')!.textContent).not.toBe(T.showing));
};

describe('result lookup', () => {
  it('shows the one sentence for a miss, whichever of roll or phone was wrong', async () => {
    const root = page('result');
    await mountLookup(root, T, { fetchImpl: vi.fn(async () => json(404)) as never });
    await submit(root);
    expect(root.querySelector('[data-status]')!.textContent).toBe(T.miss);
    expect(root.querySelector('[data-out]')!.textContent).toBe('');
  });

  it('sends Bangla digits as ASCII and never puts them in the URL', async () => {
    const f = vi.fn(async () => json(404));
    await fetchResult('১২', '০১৭১১১১১১১১', f as never);
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('/_api/admission/result');
    expect(JSON.parse(init.body as string)).toEqual({ roll_number: '12', guardian_phone: '01711111111' });
  });

  it('a hit shows published parts only: stage and list place, no deadline when none is sent', () => {
    const el = renderResult(
      { applicant_name: 'Rina', roll_number: '12', intake_title: 'C1', status: 'SHORTLISTED',
        stages: [{ title: 'Written', outcome: 'PASSED' }], lists: [{ kind: 'WAITING', sequence: 1, position: 3 }] },
      T,
    );
    expect(el.textContent).toContain('Written');
    expect(el.textContent).toContain('অপেক্ষা-তালিকা 1-এ 3 নম্বরে');
    expect(el.textContent).not.toContain('ভর্তির শেষ তারিখ');
  });

  it('admit card: print block has roll, schedule and photo box; button prints it', async () => {
    const root = page('result');
    const print = vi.fn();
    const f = vi.fn(async (u: string) =>
      u.endsWith('admit-card')
        ? json(200, { applicant_name: 'Rina', roll_number: '12', guardian_name: 'G', date_of_birth: null, intake_title: 'C1',
            schedule: [{ title: 'Written', date: '2027-01-02', start_time: '10:00', venue: 'Hall' }] })
        : json(200, { applicant_name: 'Rina', roll_number: '12', intake_title: 'C1', status: 'PENDING', stages: [], lists: [] }),
    );
    await mountLookup(root, T, { fetchImpl: f as never, print });
    await submit(root);
    root.querySelector<HTMLButtonElement>('button')!.click();
    await vi.waitFor(() => expect(print).toHaveBeenCalled());
    const card = root.querySelector('.adm-card')!;
    expect(card.textContent).toContain('12');
    expect(card.textContent).toContain('Hall');
    expect(card.querySelector('.adm-photo')).not.toBeNull();
    expect(renderAdmitCard({ ...({} as never), schedule: [] , applicant_name: '', roll_number: '', guardian_name: '', date_of_birth: null, intake_title: '' }, T).textContent).toContain(T.admitNone);
  });
});

describe('result island races', () => {
  it('admit-card button uses the roll and phone of the displayed result, not the edited inputs', async () => {
    const root = page('result');
    const f = vi.fn(async (u: string, init?: RequestInit) =>
      u.endsWith('admit-card')
        ? json(200, { applicant_name: 'A', roll_number: '12', guardian_name: 'G', date_of_birth: null, intake_title: 'C1', schedule: [] })
        : json(200, { applicant_name: 'A', roll_number: '12', intake_title: 'C1', status: 'PENDING', stages: [], lists: [] }),
    );
    await mountLookup(root, T, { fetchImpl: f as never, print: vi.fn() });
    await submit(root);
    (root.querySelector('input[name=roll]') as HTMLInputElement).value = '99';
    root.querySelector<HTMLButtonElement>('button')!.click();
    await vi.waitFor(() => expect(f.mock.calls.length).toBe(2));
    const body = JSON.parse((f.mock.calls[1] as unknown as [string, RequestInit])[1].body as string);
    expect(body.roll_number).toBe('12');
  });

  it('a stale failure does not wipe a newer result', async () => {
    const root = page('result');
    let slowReject!: () => void;
    let n = 0;
    const f = vi.fn(() =>
      ++n === 1
        ? new Promise<Response>((res) => (slowReject = () => res(json(404))))
        : Promise.resolve(json(200, { applicant_name: 'B', roll_number: '12', intake_title: 'C1', status: 'PENDING', stages: [], lists: [] })),
    );
    await mountLookup(root, T, { fetchImpl: f as never });
    const form = root.querySelector('form')!;
    form.dispatchEvent(new Event('submit', { cancelable: true }));
    form.dispatchEvent(new Event('submit', { cancelable: true }));
    await vi.waitFor(() => expect(root.querySelector('[data-out]')!.textContent).toContain('B'));
    slowReject();
    await new Promise((r) => setTimeout(r, 10));
    expect(root.querySelector('[data-out]')!.textContent).toContain('B');
  });
});

describe('lists', () => {
  it('shows roll numbers, and a name only when the server sent one', () => {
    const el = renderLists(
      [{ id: 'l', kind: 'MERIT', sequence: 1, intake_title: 'C1', act_by_date: '2027-01-05',
         members: [{ position: 1, roll_number: '5' }] }],
      T,
    );
    expect(el.textContent).toContain('5');
    expect(el.textContent).toContain('2027-01-05');
    expect(el.textContent).not.toMatch(/Rina/);
  });
  it('an unpublished school shows the empty sentence', async () => {
    const root = page('lists');
    await mountLookup(root, T, { fetchImpl: vi.fn(async () => json(200, [])) as never });
    expect(root.querySelector('[data-status]')!.textContent).toBe(T.noLists);
  });
});

it('bn and en lookup keys match', () => {
  expect(Object.keys(flat(en.admission.lookup)).sort()).toEqual(Object.keys(flat(bn.admission.lookup)).sort());
});

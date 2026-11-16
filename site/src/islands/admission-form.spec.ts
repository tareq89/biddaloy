// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { mountAdmission } from './admission-form';
import { submitApplication, validate, type AdmissionRound } from '../lib/admission';
import bn from '../i18n/bn.json';
import en from '../i18n/en.json';

const flat = (o: Record<string, unknown>, p = ''): Record<string, string> =>
  Object.fromEntries(
    Object.entries(o).flatMap(([k, v]) =>
      typeof v === 'string' ? [[p + k, v]] : Object.entries(flat(v as Record<string, unknown>, `${p}${k}.`)),
    ),
  );
const T = flat(bn.admission);
const f = (key: string, input: string, required = false) => ({
  key,
  label: { bn: key, en: key },
  input,
  required,
});
const round = (fee: number | null): AdmissionRound => ({
  id: '11111111-1111-4111-8111-111111111111',
  title: 'Class 1',
  seat_count: 40,
  open_date: '2026-11-01',
  close_date: '2026-12-15',
  form: {
    fields: [f('name', 'text', true), f('guardian_phone', 'phone', true), f('quota_disabled', 'boolean')] as never,
    documents: [],
  },
  fee_amount_paisa: fee,
  fee_pay_methods: null,
});
const reply = (status: number, json?: unknown) =>
  vi.fn(async () => new Response(json === undefined ? null : JSON.stringify(json), { status }));

function mount(r: AdmissionRound, fetchImpl = reply(201, { reference_number: 'ADM-1', status: 'PENDING' })) {
  document.body.innerHTML = '<div id="r"></div>';
  const root = document.getElementById('r')!;
  root.dataset.t = JSON.stringify(T);
  root.dataset.lang = 'bn';
  root.dataset.rounds = JSON.stringify([r]);
  mountAdmission(root, { captcha: { token: () => 'tok', reset: () => {} }, fetchImpl: fetchImpl as never });
  const form = root.querySelector('form')!;
  const set = (n: string, v: string) => ((form.elements.namedItem(n) as HTMLInputElement).value = v);
  const submit = () => form.dispatchEvent(new Event('submit', { cancelable: true }));
  return { root, form, set, submit, fetchImpl };
}

describe('admission form', () => {
  it('draws the fields of the round schema', () => {
    const { form } = mount(round(null));
    expect(['name', 'guardian_phone', 'quota_disabled'].every((n) => form.elements.namedItem(n))).toBe(true);
    expect((form.elements.namedItem('guardian_phone') as HTMLInputElement).type).toBe('tel');
    expect((form.elements.namedItem('quota_disabled') as HTMLInputElement).type).toBe('checkbox');
  });

  it('a missing required field blocks the submit and names the field', async () => {
    const { form, submit, fetchImpl } = mount(round(null));
    await submit();
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(form.querySelector('[data-key=name] .adm-err')!.textContent).toBe(T['err.missing']);
  });

  it('fee fields appear only when the round has a fee', () => {
    expect(mount(round(null)).form.elements.namedItem('feeMethod')).toBeNull();
    const { form } = mount(round(25000));
    expect(form.elements.namedItem('feeMethod')).not.toBeNull();
    expect(form.elements.namedItem('feeProof')).not.toBeNull();
    expect(form.textContent).toContain('250');
  });

  it('a file over 5 MB shows the plain text, not a status code', async () => {
    const { form, submit, set } = mount(round(25000));
    set('name', 'রহিম');
    set('guardian_phone', '01712345678');
    set('feeMethod', 'BKASH');
    set('feeReference', 'TX1');
    const big = new File(['x'], 'a.png', { type: 'image/png' });
    Object.defineProperty(big, 'size', { value: 6 * 1024 * 1024 });
    const input = form.elements.namedItem('feeProof') as HTMLInputElement;
    Object.defineProperty(input, 'files', { value: [big] });
    await submit();
    expect(form.querySelector('[data-key=feeProof] .adm-err')!.textContent).toBe('ফাইলটি অনেক বড়। ৫ এমবির মধ্যে দিন।');
  });

  it('a double click submits once and shows the reference number', async () => {
    const { root, set, submit, fetchImpl } = mount(round(null));
    set('name', 'রহিম');
    set('guardian_phone', '01712345678');
    const first = submit();
    submit();
    await first;
    await vi.waitFor(() => expect(root.querySelector('.adm-ref')?.textContent).toBe('ADM-1'));
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const init = (fetchImpl.mock.calls[0] as unknown as [string, RequestInit])[1];
    expect((init.headers as Record<string, string>)['idempotency-key']).toMatch(/[0-9a-f-]{36}/);
  });

  it('FEE_PENDING tells the guardian the school will check the fee', async () => {
    const { root, set, submit } = mount(round(null), reply(201, { reference_number: 'ADM-2', status: 'FEE_PENDING' }));
    set('name', 'রহিম');
    set('guardian_phone', '01712345678');
    await submit();
    await vi.waitFor(() => expect(root.textContent).toContain(T.feePending));
  });
});

describe('submitApplication', () => {
  it.each([
    [413, undefined, 'tooBig'],
    [400, { details: { code: 'FEE_PROOF_REQUIRED' } }, 'feeProof'],
    [400, { details: { code: 'CAPTCHA_FAILED' } }, 'captcha'],
    [409, undefined, 'duplicate'],
    [429, undefined, 'rate'],
    [404, undefined, 'closed'],
    [500, undefined, 'error'],
  ])('%s %j -> %s', async (status, json, kind) => {
    expect((await submitApplication(new FormData(), 'k', reply(status, json) as never)).kind).toBe(kind);
  });
  it('server codes REQUIRED / INVALID are passed through as sent (the island maps them to err keys)', async () => {
    const r = await submitApplication(
      new FormData(),
      'k',
      reply(400, { details: { code: 'INVALID_FORM_FIELDS', fields: { ssc_gpa: 'INVALID' } } }) as never,
    );
    expect(r).toEqual({ kind: 'fields', fields: { ssc_gpa: 'INVALID' } });
  });
  it('INVALID_FORM_FIELDS carries the field names', async () => {
    const r = await submitApplication(
      new FormData(),
      'k',
      reply(400, { details: { code: 'INVALID_FORM_FIELDS', fields: { ssc_gpa: 'invalid' } } }) as never,
    );
    expect(r).toEqual({ kind: 'fields', fields: { ssc_gpa: 'invalid' } });
  });
});

describe('copy', () => {
  const never = /intake|batch|pipeline|phase|workflow|waitlist|reconciliation|approve|reject|paid|unpaid|ইনটেক|ব্যাচ|পাইপলাইন/i;
  it('en and bn have the same keys and no never-say word', () => {
    expect(Object.keys(flat(en.admission)).sort()).toEqual(Object.keys(flat(bn.admission)).sort());
    expect(Object.values({ ...flat(en.admission), ...T }).some((v) => never.test(v))).toBe(false);
  });
});

describe('Bangla phone digits', () => {
  it('validate accepts them for a phone field', () => {
    const r = round(null);
    const phoneField = r.form.fields.find((f) => f.input === 'phone');
    if (!phoneField) return;
    const bad = validate(r, { values: { [phoneField.key]: '০১৭১২৩৪৫৬৭৮' }, files: {}, feeMethod: '', feeReference: '' });
    expect(bad[phoneField.key]).toBeUndefined();
  });
});

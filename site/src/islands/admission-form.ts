// Admission form island (Epic 71, #4188). Plain TypeScript: pick a round, draw its fields, one write.
// All copy comes from `data-t` (the `admission.*` i18n keys); server text is never shown.
import {
  buildBody,
  hasFee,
  inputFields,
  payMethods,
  submitApplication,
  taka,
  validate,
  type AdmissionRound,
  type Files,
  type SubmitResult,
  type Values,
} from '../lib/admission';

type Dict = Record<string, string>;
export interface Captcha {
  token(): string;
  reset(): void;
}
export interface Deps {
  captcha: Captcha;
  fetchImpl?: typeof fetch;
}

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: Partial<Omit<HTMLElementTagNameMap[K], 'dataset'>> & { dataset?: Record<string, string> } & Record<string, unknown> = {},
  kids: (Node | string)[] = [],
): HTMLElementTagNameMap[K] {
  const n = document.createElement(tag);
  const { dataset, ...rest } = props as { dataset?: Record<string, string> };
  Object.assign(n, rest);
  Object.assign(n.dataset, dataset);
  n.append(...kids);
  return n;
}

/**
 * The slot the gateway epic (#4166) fills with "pay now". Today it is the manual path: a method,
 * the number or reference the guardian paid with, and the screenshot or slip.
 */
export function renderPaymentMethods(round: AdmissionRound, t: Dict): HTMLElement {
  const box = el('fieldset', { className: 'adm-fee' }, [
    el('legend', {}, [t.feeTitle]),
    el('p', {}, [t.feeLine.replace('{n}', taka(round.fee_amount_paisa ?? 0))]),
  ]);
  const sel = el('select', { name: 'feeMethod', required: true }, [
    el('option', { value: '' }, [t.pick]),
    ...payMethods(round).map((m) => el('option', { value: m }, [t[`method.${m}`] ?? m])),
  ]);
  box.append(
    field(t.feeMethod, sel, 'feeMethod'),
    field(t.feeReference, el('input', { name: 'feeReference', maxLength: 100, autocomplete: 'off' }), 'feeReference'),
    fileField(t.feeProof, 'feeProof', t),
  );
  return box;
}

function field(label: string, control: HTMLElement, key: string): HTMLElement {
  return el('label', { className: 'field', dataset: { key } }, [
    el('span', {}, [label]),
    control,
    el('small', { className: 'adm-err', role: 'alert' }),
  ]);
}

function fileField(label: string, key: string, t: Dict): HTMLElement {
  const input = el('input', { type: 'file', name: key, accept: 'image/png,image/jpeg,image/webp,application/pdf' });
  const prev = el('span', { className: 'adm-prev' });
  input.addEventListener('change', () => {
    prev.replaceChildren();
    const f = input.files?.[0];
    if (!f) return;
    prev.append(`${f.name} (${Math.max(1, Math.round(f.size / 1024))} KB)`);
    if (f.type.startsWith('image/') && typeof URL.createObjectURL === 'function')
      prev.append(el('img', { src: URL.createObjectURL(f), alt: t.preview, className: 'adm-thumb' }));
  });
  return field(label, el('span', { className: 'adm-file' }, [input, prev]), key);
}

export function mountAdmission(root: HTMLElement, deps: Deps): void {
  const t = JSON.parse(root.dataset.t ?? '{}') as Dict;
  const lang = root.dataset.lang === 'en' ? 'en' : 'bn';
  const rounds = JSON.parse(root.dataset.rounds ?? '[]') as AdmissionRound[];
  const host = el('div');
  root.append(host);
  const status = el('p', { role: 'status' });
  status.setAttribute('aria-live', 'polite');

  const dates = (r: AdmissionRound) => t.dates.replace('{date}', r.close_date);
  const pickRound = (r: AdmissionRound) => draw(r);
  const preselected = rounds.find((r) => r.id === root.dataset.round) ?? (rounds.length === 1 ? rounds[0] : undefined);
  if (preselected) pickRound(preselected);
  else {
    host.append(
      el('p', {}, [t.pickRound]),
      el('div', { className: 'adm-rounds' }, rounds.map((r) =>
        el('button', { type: 'button', className: 'btn btn-ghost adm-round', onclick: () => pickRound(r) }, [
          `${r.title} · ${dates(r)}`,
        ]),
      )),
    );
  }

  function draw(round: AdmissionRound) {
    const form = el('form', { noValidate: true, className: 'adm-form', dataset: { round: round.id } });
    // Without this a click before the script is ready submits natively as a GET (phone in the URL).
    form.addEventListener('submit', (e) => e.preventDefault());
    form.append(el('h2', {}, [round.title]), el('p', { className: 'muted' }, [dates(round)]));
    for (const f of inputFields(round)) {
      const label = `${f.label[lang] ?? f.label.bn}${f.required ? ' *' : ''}`;
      let c: HTMLElement;
      if (f.input === 'textarea') c = el('textarea', { name: f.key, rows: 3 });
      else if (f.input === 'select')
        c = el('select', { name: f.key }, [
          el('option', { value: '' }, [t.pick]),
          ...(f.options ?? []).map((o) => el('option', { value: o }, [t[`opt.${o}`] ?? o])),
        ]);
      else if (f.input === 'boolean') c = el('input', { name: f.key, type: 'checkbox' });
      else
        c = el('input', {
          name: f.key,
          type: f.input === 'date' ? 'date' : f.input === 'phone' ? 'tel' : 'text',
          inputMode: f.input === 'phone' ? 'tel' : f.input === 'number' ? 'decimal' : undefined,
        });
      form.append(field(label, c, f.key));
    }
    for (const d of round.form.documents) form.append(fileField(`${t[`doc.${d}`] ?? d} *`, `doc:${d}`, t));
    if (hasFee(round)) form.append(renderPaymentMethods(round, t));
    const box = el('div', { dataset: { captcha: '' } });
    const button = el('button', { type: 'submit', className: 'btn btn-primary' }, [t.send]);
    form.append(box, button, status);
    host.replaceChildren(form);

    const setErr = (key: string, msg: string) => {
      const n = form.querySelector<HTMLElement>(`[data-key="${CSS.escape(key)}"] .adm-err`);
      if (n) n.textContent = msg;
    };
    const clearErrs = () => form.querySelectorAll('.adm-err').forEach((n) => (n.textContent = ''));
    const read = () => {
      const values: Values = {};
      const files: Files = {};
      for (const f of inputFields(round)) {
        const c = form.elements.namedItem(f.key) as HTMLInputElement | null;
        values[f.key] = f.input === 'boolean' ? !!c?.checked : (c?.value ?? '');
      }
      form.querySelectorAll<HTMLInputElement>('input[type=file]').forEach((i) => (files[i.name] = i.files?.[0]));
      const v = (n: string) => (form.elements.namedItem(n) as HTMLInputElement | null)?.value ?? '';
      return { values, files, feeMethod: v('feeMethod'), feeReference: v('feeReference') };
    };
    const SERVER_CODE: Record<string, string> = { REQUIRED: 'missing', INVALID: 'invalid' };
    const msg = (code: string) => t[`err.${SERVER_CODE[code] ?? code}`] ?? t['err.missing'];
    const say = (text: string, ok = false) => {
      status.textContent = text;
      status.className = ok ? 'ok' : 'bad';
    };

    // One key per fill-in: a double click or a retry after a lost answer is the same submit.
    let key = crypto.randomUUID();
    let busy = false;
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      if (busy) return;
      clearErrs();
      const input = read();
      const bad = validate(round, input);
      const names = Object.keys(bad);
      if (names.length > 0) {
        for (const k of names) setErr(k, msg(bad[k]));
        say(t.fixFields);
        form.querySelector<HTMLElement>(`[data-key="${CSS.escape(names[0])}"] :is(input,select,textarea)`)?.focus();
        return;
      }
      if (!deps.captcha.token()) return say(t['res.captcha']);
      busy = true;
      button.disabled = true;
      say(t.sending);
      const res = await submitApplication(buildBody(round, input, deps.captcha.token()), key, deps.fetchImpl);
      busy = false;
      button.disabled = false;
      deps.captcha.reset(); // a Turnstile token is single use
      done(res);
    });

    function done(res: SubmitResult) {
      if (res.kind === 'success') {
        host.replaceChildren(
          el('section', { className: 'adm-done', role: 'status' }, [
            el('p', {}, [t.thanks]),
            el('p', { className: 'adm-ref' }, [res.reference]),
            el('p', {}, [t.writeItDown]),
            ...(res.feePending ? [el('p', {}, [t.feePending])] : []),
            el('a', { className: 'btn btn-primary', href: root.dataset.statusHref ?? '#' }, [t.statusLink]),
          ]),
        );
        return;
      }
      if (res.kind === 'fields') {
        for (const [k, code] of Object.entries(res.fields)) setErr(k, msg(code));
        return say(t.fixFields);
      }
      say(t[`res.${res.kind}`] ?? t['res.error']);
    }
  }
}

interface Turnstile {
  render(el: HTMLElement, o: Record<string, unknown>): string;
  reset(id?: string): void;
}
function loadTurnstile(): Promise<Turnstile | undefined> {
  const w = window as unknown as { turnstile?: Turnstile };
  if (w.turnstile) return Promise.resolve(w.turnstile);
  return new Promise((resolve) => {
    const s = document.createElement('script');
    s.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
    s.async = true;
    s.onload = () => resolve(w.turnstile);
    s.onerror = () => resolve(undefined);
    document.head.append(s);
  });
}

async function init(root: HTMLElement) {
  const ts = await loadTurnstile();
  let token = '';
  let widget: string | undefined;
  const t = JSON.parse(root.dataset.t ?? '{}') as Dict;
  mountAdmission(root, {
    captcha: { token: () => token, reset: () => { token = ''; if (widget !== undefined) ts?.reset(widget); } },
  });
  if (!ts) {
    root.prepend(el('p', { className: 'bad', role: 'status' }, [t['res.unavailable'] ?? '']));
    return;
  }
  // The widget box exists only once a round is drawn: draw it after each form appears.
  const draw = () => {
    const box = root.querySelector<HTMLElement>('[data-captcha]:empty');
    if (box && root.dataset.sitekey)
      widget = ts.render(box, {
        sitekey: root.dataset.sitekey,
        callback: (x: string) => (token = x),
        'expired-callback': () => (token = ''),
        'error-callback': () => (token = ''),
      });
  };
  draw();
  new MutationObserver(draw).observe(root, { childList: true, subtree: true });
}

if (typeof document !== 'undefined')
  document.querySelectorAll<HTMLElement>('[data-admission]').forEach((r) => void init(r));

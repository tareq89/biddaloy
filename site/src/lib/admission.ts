// Admission form logic (Epic 71, #4188). Pure and DOM-free: the island draws, this decides.
// The server's own text is never shown (Rule 23): status + `details.code` pick a fixed sentence.

export type FieldInput =
  'text' | 'textarea' | 'phone' | 'date' | 'select' | 'number' | 'boolean' | 'file';

export interface AdmissionField {
  key: string;
  label: { bn: string; en: string };
  input: FieldInput;
  required: boolean;
  options?: readonly string[];
}

export interface AdmissionRound {
  id: string;
  title: string;
  seat_count: number;
  open_date: string;
  close_date: string;
  form: { fields: AdmissionField[]; documents: string[] };
  fee_amount_paisa: number | null;
  fee_pay_methods: string[] | null;
}

export type Values = Record<string, string | boolean>;
export type Files = Record<string, File | undefined>;

export const MAX_FILE = 5 * 1024 * 1024;
export const PAY_METHODS = ['BKASH', 'NAGAD', 'ROCKET', 'BANK'] as const;
const FILE_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'application/pdf'];

/** Catalogue keys the submit DTO carries as top-level parts. */
const CORE: Record<string, string> = {
  name: 'applicant_name',
  dob: 'date_of_birth',
  gender: 'gender',
  guardian_name: 'guardian_name',
  guardian_phone: 'guardian_phone',
};
const PHONE = /^(\+?88)?01[3-9][0-9]{8}$/;

export const hasFee = (r: AdmissionRound) => (r.fee_amount_paisa ?? 0) > 0;
/** Methods the school accepts; an empty list means all four. */
export const payMethods = (r: AdmissionRound): string[] =>
  r.fee_pay_methods?.length ? r.fee_pay_methods : [...PAY_METHODS];
/** Upload slots are the round's document list; a `file` catalogue field is one of them, not a text part. */
export const inputFields = (r: AdmissionRound) => r.form.fields.filter((f) => f.input !== 'file');

/** `null` when the file is fine, else the fixed-sentence key. */
export function fileProblem(f: File): 'tooBig' | 'badType' | null {
  if (f.size > MAX_FILE) return 'tooBig';
  return FILE_TYPES.includes(f.type) ? null : 'badType';
}

export interface FormInput {
  values: Values;
  files: Files;
  feeMethod: string;
  feeReference: string;
}

/** Field key (or `doc:<TYPE>` / `feeMethod` / `feeProof` / `feeReference`) -> message key. Empty = ok. */
export function validate(r: AdmissionRound, i: FormInput): Record<string, string> {
  const bad: Record<string, string> = {};
  for (const f of inputFields(r)) {
    const v = i.values[f.key];
    if (f.input === 'boolean') continue;
    const s = typeof v === 'string' ? v.trim() : '';
    if (!s) {
      if (f.required) bad[f.key] = 'missing';
    } else if (f.input === 'phone' && !PHONE.test(s)) bad[f.key] = 'phone';
    else if (f.input === 'number' && Number.isNaN(Number(s))) bad[f.key] = 'number';
  }
  for (const d of r.form.documents) {
    const file = i.files[`doc:${d}`];
    if (!file) bad[`doc:${d}`] = 'missing';
    else {
      const p = fileProblem(file);
      if (p) bad[`doc:${d}`] = p;
    }
  }
  if (hasFee(r)) {
    if (!i.feeMethod) bad.feeMethod = 'missing';
    if (!i.feeReference.trim()) bad.feeReference = 'missing';
    const proof = i.files.feeProof;
    if (!proof) bad.feeProof = 'missing';
    else {
      const p = fileProblem(proof);
      if (p) bad.feeProof = p;
    }
  }
  return bad;
}

export function buildBody(r: AdmissionRound, i: FormInput, captcha: string): FormData {
  const fd = new FormData();
  fd.set('intake_id', r.id);
  fd.set('captcha_token', captcha);
  const extra: Record<string, unknown> = {};
  const core: Record<string, string> = {};
  for (const f of inputFields(r)) {
    const v = i.values[f.key];
    const key = CORE[f.key];
    if (key) {
      if (typeof v === 'string' && v.trim()) core[key] = v.trim();
    } else if (f.input === 'boolean') extra[f.key] = v === true;
    else if (typeof v === 'string' && v.trim()) extra[f.key] = f.input === 'number' ? Number(v) : v.trim();
  }
  // The server needs a guardian name even when the round did not tick it: use a parent's name.
  core.guardian_name ??= String(i.values.father_name ?? i.values.mother_name ?? '').trim() || core.applicant_name;
  for (const [k, v] of Object.entries(core)) if (v) fd.set(k, v);
  fd.set('extra_fields', JSON.stringify(extra));
  for (const d of r.form.documents) {
    const file = i.files[`doc:${d}`];
    if (file) fd.set(d.toLowerCase(), file);
  }
  if (hasFee(r)) {
    fd.set('fee_method', i.feeMethod);
    fd.set('fee_reference', i.feeReference.trim());
    if (i.files.feeProof) fd.set('fee_proof', i.files.feeProof);
  }
  return fd;
}

export type SubmitResult =
  | { kind: 'success'; reference: string; feePending: boolean }
  | { kind: 'fields'; fields: Record<string, string> } // server named the fields
  | { kind: 'captcha' | 'feeProof' | 'tooBig' | 'duplicate' | 'closed' | 'rate' | 'down' | 'error' };

export async function submitApplication(
  body: FormData,
  key: string,
  fetchImpl: typeof fetch = fetch,
): Promise<SubmitResult> {
  try {
    const res = await fetchImpl('/_api/admission/applicants', {
      method: 'POST',
      headers: { accept: 'application/json', 'idempotency-key': key },
      body,
      signal: AbortSignal.timeout(30_000),
    });
    const json = (await res.json().catch(() => null)) as {
      reference_number?: string;
      status?: string;
      details?: { code?: string; fields?: Record<string, string> };
    } | null;
    if (res.status === 201 && json?.reference_number)
      return { kind: 'success', reference: json.reference_number, feePending: json.status === 'FEE_PENDING' };
    if (res.status === 413) return { kind: 'tooBig' };
    if (res.status === 400) {
      const code = json?.details?.code;
      if (code === 'CAPTCHA_FAILED') return { kind: 'captcha' };
      if (code === 'FEE_PROOF_REQUIRED') return { kind: 'feeProof' };
      if (code === 'INVALID_FORM_FIELDS' && json?.details?.fields)
        return { kind: 'fields', fields: json.details.fields };
      return { kind: 'error' };
    }
    if (res.status === 409) return { kind: 'duplicate' };
    if (res.status === 404) return { kind: 'closed' };
    if (res.status === 429) return { kind: 'rate' };
    if (res.status === 503) return { kind: 'down' };
    return { kind: 'error' };
  } catch {
    return { kind: 'error' };
  }
}

/** Paisa -> whole taka text for the fee line. */
export const taka = (paisa: number) => String(paisa / 100);

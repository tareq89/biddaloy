/**
 * [Epic 71 D5] The one catalogue of form fields a school ticks on for an
 * admission round. No free-form builder: a round stores only keys from here.
 */

export type AdmissionFieldInput =
  'text' | 'textarea' | 'phone' | 'date' | 'select' | 'number' | 'boolean' | 'file';

export interface AdmissionFieldDef {
  key: string;
  label: { bn: string; en: string };
  input: AdmissionFieldInput;
  /** Default only; the school may relax or tighten it per round. */
  required: boolean;
  group: string;
  /** i18n key of the help text (`help.*`). */
  help: string;
  options?: readonly string[];
}

const F = (
  key: string,
  bn: string,
  en: string,
  input: AdmissionFieldInput,
  group: string,
  required = false,
  options?: readonly string[],
): AdmissionFieldDef => ({
  key,
  label: { bn, en },
  input,
  required,
  group,
  help: `help.admission.field.${key}`,
  ...(options ? { options } : {}),
});

export const ADMISSION_FIELD_CATALOGUE: readonly AdmissionFieldDef[] = [
  F('name', 'আবেদনকারীর নাম', 'Applicant name', 'text', 'child', true),
  F('dob', 'জন্ম তারিখ', 'Date of birth', 'date', 'child', true),
  F('gender', 'লিঙ্গ', 'Gender', 'select', 'child', true, ['MALE', 'FEMALE', 'OTHER']),
  F('religion', 'ধর্ম', 'Religion', 'select', 'child', false, [
    'ISLAM',
    'HINDUISM',
    'BUDDHISM',
    'CHRISTIANITY',
    'OTHER',
  ]),
  F('blood_group', 'রক্তের গ্রুপ', 'Blood group', 'select', 'child', false, [
    'A+',
    'A-',
    'B+',
    'B-',
    'AB+',
    'AB-',
    'O+',
    'O-',
  ]),
  F('birth_reg_no', 'জন্মনিবন্ধন নম্বর', 'Birth registration no', 'text', 'child'),
  F('nationality', 'জাতীয়তা', 'Nationality', 'text', 'child'),
  F('photo', 'ছবি', 'Photo', 'file', 'child'),
  F('father_name', 'পিতার নাম', "Father's name", 'text', 'family', true),
  F('father_phone', 'পিতার ফোন', "Father's phone", 'phone', 'family'),
  F('father_occupation', 'পিতার পেশা', "Father's occupation", 'text', 'family'),
  F('father_nid', 'পিতার এনআইডি', "Father's NID", 'text', 'family'),
  F('mother_name', 'মাতার নাম', "Mother's name", 'text', 'family', true),
  F('mother_phone', 'মাতার ফোন', "Mother's phone", 'phone', 'family'),
  F('mother_occupation', 'মাতার পেশা', "Mother's occupation", 'text', 'family'),
  F('mother_nid', 'মাতার এনআইডি', "Mother's NID", 'text', 'family'),
  F('guardian_name', 'অভিভাবকের নাম', "Guardian's name", 'text', 'family'),
  F('guardian_phone', 'অভিভাবকের ফোন', "Guardian's phone", 'phone', 'family', true),
  F('present_address', 'বর্তমান ঠিকানা', 'Present address', 'textarea', 'address'),
  F('permanent_address', 'স্থায়ী ঠিকানা', 'Permanent address', 'textarea', 'address'),
  F('previous_school', 'পূর্বের স্কুল', 'Previous school', 'text', 'study'),
  F('previous_class', 'পূর্বের শ্রেণি', 'Previous class', 'text', 'study'),
  F('ssc_gpa', 'এসএসসি জিপিএ', 'SSC GPA', 'number', 'study'),
  F('ssc_roll', 'এসএসসি রোল', 'SSC roll', 'text', 'study'),
  F('ssc_board', 'এসএসসি বোর্ড', 'SSC board', 'text', 'study'),
  F('ssc_year', 'এসএসসি সাল', 'SSC year', 'number', 'study'),
  F('group_preference', 'বিভাগ পছন্দ', 'Group preference', 'select', 'study', false, [
    'SCIENCE',
    'COMMERCE',
    'HUMANITIES',
  ]),
  F('siblings_in_school', 'স্কুলে ভাইবোন', 'Siblings in school', 'boolean', 'other'),
  F('quota_freedom_fighter', 'মুক্তিযোদ্ধার সন্তান', 'Freedom fighter child', 'boolean', 'quota'),
  F('quota_teacher_child', 'শিক্ষকের সন্তান', 'Teacher child', 'boolean', 'quota'),
  F('quota_disabled', 'প্রতিবন্ধী', 'Disabled', 'boolean', 'quota'),
  F('quota_ethnic_minority', 'ক্ষুদ্র নৃগোষ্ঠী', 'Ethnic minority', 'boolean', 'quota'),
  F('special_needs', 'বিশেষ চাহিদা', 'Special needs', 'textarea', 'other'),
  F('transport_need', 'যাতায়াত সুবিধা প্রয়োজন', 'Needs transport', 'boolean', 'other'),
  F('heard_of_us', 'আমাদের কথা কীভাবে জানলেন', 'How they heard of us', 'text', 'other'),
];

const BY_KEY = new Map(ADMISSION_FIELD_CATALOGUE.map((d) => [d.key, d]));

/** Catalogue rows for the ticked keys, in catalogue order; unknown keys are dropped. */
export function fieldsForRound(keys: readonly string[]): AdmissionFieldDef[] {
  const want = new Set(keys);
  return ADMISSION_FIELD_CATALOGUE.filter((d) => want.has(d.key));
}

export type AdmissionFieldError = 'REQUIRED' | 'INVALID' | 'UNKNOWN_FIELD';

/** Errors for an unknown submitted key sit under this key, so the key is never echoed. */
export const UNKNOWN_FIELD_ERROR_KEY = '_unknown';

const MAX_TEXT = 500;
const isBlank = (v: unknown): boolean =>
  v === undefined || v === null || (typeof v === 'string' && v.trim() === '');

function valid(def: AdmissionFieldDef, v: unknown): boolean {
  switch (def.input) {
    case 'text':
    case 'textarea':
      return typeof v === 'string' && v.length <= MAX_TEXT;
    case 'phone':
      return typeof v === 'string' && /^01\d{9}$/.test(v);
    case 'date':
      return typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(v));
    case 'select':
      return typeof v === 'string' && (def.options ?? []).includes(v);
    case 'number':
      return typeof v === 'number' && Number.isFinite(v) && v >= 0;
    case 'boolean':
      return typeof v === 'boolean';
    case 'file':
      return true; // uploads are checked by signature elsewhere (Rule 6)
  }
}

/**
 * Check submitted values against the ticked keys. Returns field-keyed error
 * codes (never the submitted value, Rule 23); `{}` means valid. A key not
 * ticked for the round counts as unknown.
 */
export function validateExtraFields(
  keys: readonly string[],
  values: Readonly<Record<string, unknown>>,
  requiredOverride: Readonly<Record<string, boolean>> = {},
): Record<string, AdmissionFieldError> {
  const errors: Record<string, AdmissionFieldError> = {};
  const ticked = new Set(keys.filter((k) => BY_KEY.has(k)));
  for (const k of Object.keys(values)) {
    if (!ticked.has(k)) errors[UNKNOWN_FIELD_ERROR_KEY] = 'UNKNOWN_FIELD';
  }
  for (const def of fieldsForRound(keys)) {
    const v = values[def.key];
    const required = requiredOverride[def.key] ?? def.required;
    if (isBlank(v)) {
      if (required && def.input !== 'file') errors[def.key] = 'REQUIRED';
    } else if (!valid(def, v)) {
      errors[def.key] = 'INVALID';
    }
  }
  return errors;
}

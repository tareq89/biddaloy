import { ApplicationAddressee, ApplicationType, UserRole } from '@biddaloy/shared';
import type { ApplicationStep } from '@biddaloy/shared';
import type { TemplateLocale } from '../account-access/account-access-templates';

type Locale = TemplateLocale;

export type TitleKey = 'CLASS_TEACHER' | 'HEADMASTER' | 'EXAM_CONTROLLER' | 'OFFICE';

export const LETTER_TITLES: Record<TitleKey, Record<Locale, string>> = {
  CLASS_TEACHER: { bn: 'শ্রেণি শিক্ষক', en: 'Class Teacher' },
  HEADMASTER: { bn: 'প্রধান শিক্ষক', en: 'Headmaster' },
  EXAM_CONTROLLER: { bn: 'পরীক্ষা নিয়ন্ত্রক', en: 'Exam Controller' },
  OFFICE: { bn: 'অফিস', en: 'Office' },
};

/** D13: the "To" line names whoever decides last, keyed on the step (not the type). */
export function titleKeyForStep(step: ApplicationStep): TitleKey | null {
  switch (step.kind) {
    case 'CLASS_TEACHER':
      return 'CLASS_TEACHER';
    case 'PERMISSION':
      return 'HEADMASTER';
    case 'ROLES':
      if (step.roles.includes(UserRole.OFFICE_STAFF)) return 'OFFICE';
      if (step.roles.includes(UserRole.EXAM_CONTROLLER)) return 'EXAM_CONTROLLER';
      return 'HEADMASTER';
    case 'ADDRESSEE':
      return null; // GENERAL: from the chosen addressee
  }
}

export function titleKeyForAddressee(a: ApplicationAddressee): TitleKey | null {
  if (a === ApplicationAddressee.CLASS_TEACHER) return 'CLASS_TEACHER';
  if (a === ApplicationAddressee.HEADMASTER) return 'HEADMASTER';
  if (a === ApplicationAddressee.OFFICE) return 'OFFICE';
  return null; // STAFF_USER: that user's name
}

export const GUARDIAN_LABEL: Record<Locale, string> = { bn: 'অভিভাবক', en: 'Guardian' };
export const CHILD_LABEL: Record<Locale, string> = { bn: 'সন্তান', en: 'child' };
export const ALL_FEES_LABEL: Record<Locale, string> = { bn: 'সকল ফি', en: 'all fees' };
/** Fee-type enum labels (FeeType); unknown values fall back to the raw code. */
export const FEE_TYPE_LABELS: Record<string, Record<Locale, string>> = {
  MONTHLY_TUITION: { bn: 'মাসিক বেতন', en: 'monthly tuition' },
  EXAM_FEE: { bn: 'পরীক্ষা ফি', en: 'exam fee' },
  LIBRARY_FEE: { bn: 'লাইব্রেরি ফি', en: 'library fee' },
  LAB_FEE: { bn: 'ল্যাব ফি', en: 'lab fee' },
  SPORTS_FEE: { bn: 'ক্রীড়া ফি', en: 'sports fee' },
  COMPUTER_FEE: { bn: 'কম্পিউটার ফি', en: 'computer fee' },
  TRANSPORT_FEE: { bn: 'যাতায়াত ফি', en: 'transport fee' },
  ANNUAL_FEE: { bn: 'বার্ষিক ফি', en: 'annual fee' },
  ADMISSION_FEE: { bn: 'ভর্তি ফি', en: 'admission fee' },
  LATE_FEE: { bn: 'বিলম্ব ফি', en: 'late fee' },
  FINE: { bn: 'জরিমানা', en: 'fine' },
  OTHER: { bn: 'অন্যান্য', en: 'other' },
};
export const SERIAL_LABEL: Record<Locale, string> = { bn: 'আবেদন নং', en: 'Application no.' };

/** Enum labels (leave type, `StudentLeaveReason`); the client's applications.json is not readable here. */
export const LEAVE_TYPE_LABELS: Record<string, Record<Locale, string>> = {
  CASUAL: { bn: 'নৈমিত্তিক', en: 'Casual' },
  SICK: { bn: 'অসুস্থতাজনিত', en: 'Sick' },
  MATERNITY: { bn: 'মাতৃত্বকালীন', en: 'Maternity' },
  PATERNITY: { bn: 'পিতৃত্বকালীন', en: 'Paternity' },
  EARNED: { bn: 'অর্জিত', en: 'Earned' },
};
export const STUDENT_LEAVE_REASON_LABELS: Record<string, Record<Locale, string>> = {
  SICK: { bn: 'অসুস্থতার', en: 'illness' },
  FAMILY: { bn: 'পারিবারিক', en: 'family reasons' },
  OTHER: { bn: 'অন্য', en: 'other reasons' },
};

/**
 * Common frame. Placeholders: date, to, school, sign. `to` and `sign` are multi-line blocks built
 * in code so an empty relation / absent serial leaves no blank line.
 */
const FRAME: Record<Locale, (subject: string, body: string) => string> = {
  bn: (subject, body) =>
    `তারিখ: {{date}}\nবরাবর\n{{to}}\n{{school}}\n\nবিষয়: ${subject}\n\nজনাব,\n${body}\n\nবিনীত\n{{sign}}`,
  en: (subject, body) =>
    `Date: {{date}}\nTo\n{{to}}\n{{school}}\n\nSubject: ${subject}\n\nSir/Madam,\n${body}\n\nSincerely\n{{sign}}`,
};

type Pair = Record<Locale, [subject: string, body: string]>;

const BODIES: Record<ApplicationType, Pair> = {
  [ApplicationType.STAFF_LEAVE]: {
    bn: [
      '{{leave_type_label}} ছুটির আবেদন',
      '{{start_date}} থেকে {{end_date}} পর্যন্ত ({{days}} কর্মদিবস) ছুটি প্রয়োজন। কারণ: {{reason}}',
    ],
    en: [
      '{{leave_type_label}} leave application',
      'I need leave from {{start_date}} to {{end_date}} ({{days}} working days). Reason: {{reason}}',
    ],
  },
  [ApplicationType.STUDENT_LEAVE]: {
    bn: [
      'ছুটির আবেদন',
      'আমার {{relation_child}} {{student_line}}, {{reason_label}} কারণে {{start_date}} থেকে {{end_date}} পর্যন্ত বিদ্যালয়ে উপস্থিত থাকতে পারবে না। {{details}}',
    ],
    en: [
      'Leave application',
      'My {{relation_child}} {{student_line}}, will not be able to attend school from {{start_date}} to {{end_date}} due to {{reason_label}}. {{details}}',
    ],
  },
  [ApplicationType.FEE_WAIVER]: {
    bn: [
      'বেতন মওকুফের আবেদন',
      'আমার {{relation_child}} {{student_line}}-এর {{fee_types}} বাবদ {{value}}{{kind_suffix}} মওকুফের আবেদন করছি{{period}}। কারণ: {{reason}}',
    ],
    en: [
      'Fee waiver application',
      'I request a waiver of {{value}}{{kind_suffix}} on {{fee_types}} for my {{relation_child}} {{student_line}}{{period}}. Reason: {{reason}}',
    ],
  },
  [ApplicationType.TESTIMONIAL]: {
    bn: [
      'প্রশংসাপত্রের আবেদন',
      'আমার {{relation_child}} {{student_line}}-এর জন্য একটি প্রশংসাপত্র প্রয়োজন। উদ্দেশ্য: {{purpose}}',
    ],
    en: [
      'Testimonial application',
      'I need a testimonial for my {{relation_child}} {{student_line}}. Purpose: {{purpose}}',
    ],
  },
  [ApplicationType.TRANSFER_CERTIFICATE]: {
    bn: [
      'ছাড়পত্রের আবেদন',
      'আমার {{relation_child}} {{student_line}}, {{leaving_date}} তারিখে বিদ্যালয় ত্যাগ করবে{{destination_clause}}। কারণ: {{reason}}',
    ],
    en: [
      'Transfer certificate application',
      'My {{relation_child}} {{student_line}}, will leave the school on {{leaving_date}}{{destination_clause}}. Reason: {{reason}}',
    ],
  },
  [ApplicationType.READMISSION]: {
    bn: [
      'পুনঃভর্তির আবেদন',
      'আমার {{relation_child}} {{student_name}}-কে {{target_section}} এ {{occurred_on}} তারিখে পুনঃভর্তি করার আবেদন করছি। কারণ: {{reason}}',
    ],
    en: [
      'Readmission application',
      'I request readmission of my {{relation_child}} {{student_name}} to {{target_section}} on {{occurred_on}}. Reason: {{reason}}',
    ],
  },
  [ApplicationType.SECTION_CHANGE]: {
    bn: [
      'শাখা পরিবর্তনের আবেদন',
      'আমার {{relation_child}} {{student_line}}-কে {{from_section}} থেকে {{target_section}} এ স্থানান্তরের আবেদন করছি। কারণ: {{reason}}',
    ],
    en: [
      'Section change application',
      'I request moving my {{relation_child}} {{student_line}}, from {{from_section}} to {{target_section}}. Reason: {{reason}}',
    ],
  },
  [ApplicationType.SCRIPT_RECHECK]: {
    bn: [
      'খাতা পুনঃনিরীক্ষণের আবেদন',
      'আমার {{relation_child}} {{student_line}}-এর {{exam_name}} পরীক্ষার {{subject_title}} বিষয়ের খাতা পুনঃনিরীক্ষণ করার আবেদন করছি। কারণ: {{reason}}',
    ],
    en: [
      'Script recheck application',
      'I request a recheck of the {{subject_title}} script in {{exam_name}} for my {{relation_child}} {{student_line}}. Reason: {{reason}}',
    ],
  },
  [ApplicationType.ID_CARD_REPRINT]: {
    bn: [
      'পরিচয়পত্র পুনরায় ছাপানোর আবেদন',
      'আমার {{relation_child}} {{student_line}}-এর পরিচয়পত্র পুনরায় ছাপানো প্রয়োজন। কারণ: {{reason}}',
    ],
    en: [
      'ID card reprint application',
      'My {{relation_child}} {{student_line}}, needs the ID card reprinted. Reason: {{reason}}',
    ],
  },
  [ApplicationType.GENERAL]: {
    bn: ['{{subject_line}}', '{{body}}'],
    en: ['{{subject_line}}', '{{body}}'],
  },
};

export const LETTER_TEMPLATES = Object.fromEntries(
  Object.entries(BODIES).map(([type, pair]) => [
    type,
    { bn: FRAME.bn(...pair.bn), en: FRAME.en(...pair.en) },
  ]),
) as Record<ApplicationType, Record<Locale, string>>;

/**
 * Single pass: a value is never re-scanned, so a user typing `{{school}}` gets it literally.
 * Unknown keys fill with ''.
 */
export function fill(template: string, vars: Record<string, string>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_m, key: string) => vars[key] ?? '');
}

/**
 * User text -> plain text that is also safe if someone later renders it as HTML:
 * drops `\r`, control chars (tabs become a space; `\n` is kept for multi-line reasons),
 * bidi-override marks, and the angle brackets `<` `>`.
 */
export function cleanText(v: unknown): string {
  if (v === null || v === undefined) return '';
  return String(v)
    .replace(/\t/g, ' ')
    .replace(/[\u2028\u2029]/g, '\n')
    .replace(/(?!\n)\p{Cc}/gu, '')
    .replace(/[\u202A-\u202E\u2066-\u2069]/g, '')
    .replace(/[<>]/g, '')
    .trim();
}

/** 'YYYY-MM-DD' -> 'DD/MM/YYYY'; anything else passes through (cleaned by the caller). */
export function formatLetterDate(v: unknown): string {
  const s = typeof v === 'string' ? v : '';
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : s;
}

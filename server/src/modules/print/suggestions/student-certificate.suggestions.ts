import { DocumentKind, FIELD_CATALOG, fillPlaceholders } from '@biddaloy/shared';
import type { PrintElement } from '@biddaloy/shared';
import {
  NAVY,
  PLACEHOLDER_ASSET,
  SANS,
  SERIF_BN,
  ids,
  text,
  type Rect,
} from './suggestion-helpers';
import type { PrintSuggestion } from './suggestions';

type Lang = 'bn' | 'en';
type CertKind = (typeof DocumentKind)[
  | 'TRANSFER_CERTIFICATE'
  | 'TESTIMONIAL'
  | 'CHARACTER_CERTIFICATE'
  | 'STUDY_CERTIFICATE'
  | 'PARTICIPATION_CERTIFICATE'];

/** Body font and the line metrics the layout reserves room for (rough: see the spec guard). */
export const BODY_PT = 11;
export const MM_PER_CHAR = 2.2;
export const LINE_MM = 5.6;
const BODY_X = 20;
const BODY_W = 170;
const BODY_TOP = 82;
const GAP = 4;

/** Height a paragraph needs when every placeholder holds its catalog's longest sample. */
export function paragraphHeight(kind: DocumentKind, paragraph: string): number {
  const catalog = FIELD_CATALOG[kind];
  const filled = fillPlaceholders(paragraph, (k) => {
    const f = catalog.find((c) => c.key === k);
    return f?.longestSample ?? f?.sample ?? '';
  });
  return Math.ceil((filled.length * MM_PER_CHAR) / BODY_W) * LINE_MM;
}

const TITLES: Record<CertKind, [bn: string, en: string, slug: string]> = {
  [DocumentKind.TRANSFER_CERTIFICATE]: ['ছাড়পত্র', 'TRANSFER CERTIFICATE', 'tc'],
  [DocumentKind.TESTIMONIAL]: ['প্রশংসাপত্র', 'TESTIMONIAL', 'testimonial'],
  [DocumentKind.CHARACTER_CERTIFICATE]: ['চারিত্রিক সনদপত্র', 'CHARACTER CERTIFICATE', 'character'],
  [DocumentKind.STUDY_CERTIFICATE]: ['অধ্যয়ন প্রত্যয়নপত্র', 'STUDY CERTIFICATE', 'study'],
  [DocumentKind.PARTICIPATION_CERTIFICATE]: [
    'অংশগ্রহণ সনদপত্র',
    'CERTIFICATE OF PARTICIPATION',
    'participation',
  ],
};

const WISH = {
  bn: 'আমি তার সর্বাঙ্গীণ মঙ্গল কামনা করি।',
  en: 'I wish him/her every success in life.',
};

/** Sentence bodies, one string per paragraph, `{{key}}` from that kind's catalog only (D43). */
const PARAGRAPHS: Record<CertKind, Record<Lang, string[]>> = {
  [DocumentKind.TRANSFER_CERTIFICATE]: {
    bn: [
      'এই মর্মে প্রত্যয়ন করা যাচ্ছে যে, {{student.name_bn}}, পিতা {{student.father_name}}, মাতা {{student.mother_name}}, জন্ম তারিখ {{student.date_of_birth}}, এই বিদ্যালয়ে {{student.admission_date}} তারিখে ভর্তি হয়ে {{leaving.class}} শ্রেণি পর্যন্ত অধ্যয়ন করেছে। সে {{leaving.date}} তারিখে {{leaving.reason}} কারণে বিদ্যালয় ত্যাগ করেছে এবং {{leaving.destination}}-এ ভর্তি হতে ইচ্ছুক। বিদ্যালয়ে থাকাকালীন তার আচরণ {{issue.conduct}}।',
      '{{issue.remark}}',
      WISH.bn,
    ],
    en: [
      'This is to certify that {{student.name}}, son/daughter of {{student.father_name}} and {{student.mother_name}}, born on {{student.date_of_birth}}, was admitted to this school on {{student.admission_date}} and studied up to {{leaving.class}}. He/she left the school on {{leaving.date}} for the reason of {{leaving.reason}} and wishes to be admitted to {{leaving.destination}}. His/her conduct while at this school was {{issue.conduct}}.',
      '{{issue.remark}}',
      WISH.en,
    ],
  },
  [DocumentKind.TESTIMONIAL]: {
    bn: [
      'এই মর্মে প্রত্যয়ন করা যাচ্ছে যে, {{student.name_bn}}, পিতা {{student.father_name}}, মাতা {{student.mother_name}}, এই বিদ্যালয়ের একজন শিক্ষার্থী।',
      // Own paragraph: a current student with no public exam yet gets no line here (the
      // renderer drops a sentence whose every {{field}} is blank).
      'সে {{public_exam.board}} বোর্ডের অধীনে {{public_exam.year}} সালের {{public_exam.name}} পরীক্ষায় রোল নং {{public_exam.roll}}, নিবন্ধন নং {{public_exam.registration}} নিয়ে অংশগ্রহণ করে জিপিএ {{public_exam.gpa}} অর্জন করেছে।',
      'বিদ্যালয়ে অধ্যয়নকালে তার আচরণ {{issue.conduct}} ছিল। ' + WISH.bn,
    ],
    en: [
      'This is to certify that {{student.name}}, son/daughter of {{student.father_name}} and {{student.mother_name}}, is/was a student of this school.',
      'He/she appeared in the {{public_exam.name}} examination of {{public_exam.year}} under the {{public_exam.board}} Board with roll no. {{public_exam.roll}} and registration no. {{public_exam.registration}}, and obtained GPA {{public_exam.gpa}}.',
      'His/her conduct during the period of study was {{issue.conduct}}. ' + WISH.en,
    ],
  },
  [DocumentKind.CHARACTER_CERTIFICATE]: {
    bn: [
      'এই মর্মে প্রত্যয়ন করা যাচ্ছে যে, {{student.name_bn}}, পিতা {{student.father_name}}, মাতা {{student.mother_name}}, এই বিদ্যালয়ের শ্রেণি {{student.class}}, রোল নং {{student.roll}}-এর শিক্ষার্থী। আমার জানামতে তার চরিত্র ও আচরণ {{issue.conduct}}।',
      '{{issue.remark}}',
      WISH.bn,
    ],
    en: [
      'This is to certify that {{student.name}}, son/daughter of {{student.father_name}} and {{student.mother_name}}, is a student of {{student.class}}, roll no. {{student.roll}}, of this school. To the best of my knowledge, his/her character and conduct are {{issue.conduct}}.',
      '{{issue.remark}}',
      WISH.en,
    ],
  },
  [DocumentKind.STUDY_CERTIFICATE]: {
    bn: [
      'এই মর্মে প্রত্যয়ন করা যাচ্ছে যে, {{student.name_bn}}, পিতা {{student.father_name}}, মাতা {{student.mother_name}}, {{student.academic_year}} শিক্ষাবর্ষে এই বিদ্যালয়ের শ্রেণি {{student.class}}, শাখা {{student.section}}, রোল নং {{student.roll}}-এর একজন নিয়মিত শিক্ষার্থী। সে {{student.admission_date}} তারিখে এই বিদ্যালয়ে ভর্তি হয়েছে।',
      '{{issue.remark}}',
    ],
    en: [
      'This is to certify that {{student.name}}, son/daughter of {{student.father_name}} and {{student.mother_name}}, is a regular student of {{student.class}}, section {{student.section}}, roll {{student.roll}} in {{student.academic_year}} at this school. He/she was admitted on {{student.admission_date}}.',
      '{{issue.remark}}',
    ],
  },
  [DocumentKind.PARTICIPATION_CERTIFICATE]: {
    bn: [
      'এই মর্মে প্রত্যয়ন করা যাচ্ছে যে, {{student.name_bn}}, শ্রেণি {{student.class}}, রোল নং {{student.roll}}, {{issue.event_date}} তারিখে অনুষ্ঠিত {{issue.event_name}}-এ অংশগ্রহণ করেছে।',
      WISH.bn,
    ],
    en: [
      'This is to certify that {{student.name}}, of {{student.class}}, roll no. {{student.roll}}, took part in {{issue.event_name}} held on {{issue.event_date}}.',
      WISH.en,
    ],
  },
};

/** Full A4 portrait certificate on `certificate-a4-portrait-front.svg` (zones: artwork/README.md). */
function buildCertificate(kind: CertKind, lang: Lang): PrintSuggestion {
  const bn = lang === 'bn';
  const font = bn ? SERIF_BN : SANS;
  const c = NAVY;
  const [titleBn, titleEn, slug] = TITLES[kind];

  let y = BODY_TOP;
  const body: PrintElement[] = PARAGRAPHS[kind][lang].map((p) => {
    const h = paragraphHeight(kind, p);
    const rect: Rect = [BODY_X, y, BODY_W, h];
    y += h + GAP;
    return {
      ...text(rect, { text: p, font, pt: BODY_PT, color: c, align: 'left' }),
      overflow: 'WRAP' as const,
    };
  });

  const front: PrintElement[] = [
    {
      id: '',
      type: 'IMAGE',
      x: 20,
      y: 16,
      w: 20,
      h: 20,
      field: 'school.logo',
      fit: 'CONTAIN',
      alignY: 'center',
    },
    text([44, 17, 146, 9], {
      field: bn ? 'school.name_bn' : 'school.name',
      font,
      pt: 16,
      color: c,
      weight: 700,
      align: 'left',
    }),
    text([44, 27, 146, 6], {
      text: bn
        ? '{{school.address}} · ইআইআইএন {{school.eiin}}'
        : '{{school.address}} · EIIN {{school.eiin}}',
      font,
      pt: 9,
      color: c,
      align: 'left',
    }),
    text([20, 46, 85, 6], {
      text: `${bn ? 'ক্রমিক নং' : 'Serial no.'}: {{print.serial_no}}`,
      font,
      pt: 10,
      color: c,
      align: 'left',
    }),
    text([105, 46, 85, 6], {
      text: `${bn ? 'তারিখ' : 'Date'}: {{print.issue_date}}`,
      font,
      pt: 10,
      color: c,
      align: 'right',
    }),
    text([20, 58, 170, 14], {
      text: bn ? titleBn : titleEn,
      font,
      pt: 28,
      color: c,
      weight: 700,
      align: 'center',
    }),
    ...body,
    { id: '', type: 'QR', x: 20, y: 256, w: 22, h: 22 },
    text([46, 266, 70, 6], { field: 'print.copyLabel', font, pt: 9, color: c, align: 'left' }),
    text([130, 270, 60, 6], {
      text: bn ? 'প্রধান শিক্ষকের স্বাক্ষর' : "Head teacher's signature",
      font,
      pt: 9,
      color: c,
      align: 'center',
    }),
  ];

  return {
    key: `${slug}-a4-${lang}`,
    documentKind: kind,
    orientation: 'portrait',
    style: 'classic',
    nameKey: `print.suggestion.${slug}_a4_${lang}`,
    artwork: { front: 'certificate-a4-portrait-front.svg' },
    definition: {
      page: { widthMm: 210, heightMm: 297, sides: ['front'] },
      copyLabel: { text: 'প্রতিলিপি / DUPLICATE (copy {n})' },
      front: {
        background: { assetId: PLACEHOLDER_ASSET, print: true },
        elements: ids('front', front),
      },
    },
  };
}

export const STUDENT_CERTIFICATE_SUGGESTIONS: readonly PrintSuggestion[] = (
  Object.keys(TITLES) as CertKind[]
).flatMap((kind) => (['bn', 'en'] as const).map((lang) => buildCertificate(kind, lang)));

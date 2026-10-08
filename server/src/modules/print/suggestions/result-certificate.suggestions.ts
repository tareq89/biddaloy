import { DocumentKind } from '@biddaloy/shared';
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
type Kind = (typeof DocumentKind)['RESULT_CERTIFICATE' | 'MERIT_CERTIFICATE'];

/** Body font and rough line metrics the layout reserves room for (see the spec guard). */
export const BODY_PT = 13;
export const MM_PER_CHAR = 2.6;
export const LINE_MM = 7;
const BODY_X = 33.5;
const BODY_W = 230;
const BODY_TOP = 62;
const SENTENCE_H = 3 * LINE_MM;
const LINE_H = 8;

const TITLES: Record<Kind, [bn: string, en: string, slug: string]> = {
  [DocumentKind.RESULT_CERTIFICATE]: ['ফলাফল সনদপত্র', 'RESULT CERTIFICATE', 'result'],
  [DocumentKind.MERIT_CERTIFICATE]: ['মেধা সনদপত্র', 'MERIT CERTIFICATE', 'merit'],
};

/** Sentence bodies, `{{key}}` from that kind's catalog only (D43). Merit's section position is its own line (D29). */
const PARAGRAPHS: Record<Kind, Record<Lang, { sentence: string; extra?: string; wish: string }>> = {
  [DocumentKind.RESULT_CERTIFICATE]: {
    bn: {
      sentence:
        'এই মর্মে প্রত্যয়ন করা যাচ্ছে যে, {{student.name_bn}}, {{student.class}} শ্রেণি, শাখা {{student.section}}, রোল {{student.roll}}, {{exam.year}} সালের {{exam.name}}-এ মোট নম্বর {{result.total_marks}}, জিপিএ {{result.gpa}} (গ্রেড {{result.grade}}) পেয়ে সফলতার সাথে উত্তীর্ণ হয়েছে।',
      wish: 'আমরা তার উত্তরোত্তর সাফল্য কামনা করি।',
    },
    en: {
      sentence:
        'This is to certify that {{student.name}}, of {{student.class}}, section {{student.section}}, roll {{student.roll}}, has passed the {{exam.name}} of {{exam.year}} successfully with total marks {{result.total_marks}} and GPA {{result.gpa}} (grade {{result.grade}}).',
      wish: 'We wish him/her continued success.',
    },
  },
  [DocumentKind.MERIT_CERTIFICATE]: {
    bn: {
      sentence:
        'এই মর্মে প্রত্যয়ন করা যাচ্ছে যে, {{student.name_bn}}, {{student.class}} শ্রেণি, শাখা {{student.section}}, রোল {{student.roll}}, {{exam.year}} সালের {{exam.name}}-এ জিপিএ {{result.gpa}} (গ্রেড {{result.grade}}) পেয়ে শ্রেণিতে {{result.position}} তম স্থান অধিকার করেছে।',
      extra: 'শাখায় মেধাক্রম: {{result.section_position}}',
      wish: 'আমরা তার উত্তরোত্তর সাফল্য কামনা করি।',
    },
    en: {
      sentence:
        'This is to certify that {{student.name}}, of {{student.class}}, section {{student.section}}, roll {{student.roll}}, secured position {{result.position}} in the class in the {{exam.name}} of {{exam.year}} with GPA {{result.gpa}} (grade {{result.grade}}).',
      extra: 'Position in section: {{result.section_position}}',
      wish: 'We wish him/her continued success.',
    },
  },
};

/** A4 landscape certificate on `certificate-a4-landscape-front.svg` (clear centre [14,14,269,182]). */
function buildCertificate(kind: Kind, lang: Lang): PrintSuggestion {
  const bn = lang === 'bn';
  const font = bn ? SERIF_BN : SANS;
  const c = NAVY;
  const [titleBn, titleEn, slug] = TITLES[kind];
  const p = PARAGRAPHS[kind][lang];

  const wrap = (rect: Rect, t: string) => ({
    ...text(rect, { text: t, font, pt: BODY_PT, color: c, align: 'center' }),
    overflow: 'WRAP' as const,
  });
  let y = BODY_TOP;
  const body: PrintElement[] = [wrap([BODY_X, y, BODY_W, SENTENCE_H], p.sentence)];
  y += SENTENCE_H + 4;
  if (p.extra) {
    body.push(wrap([BODY_X, y, BODY_W, LINE_H], p.extra));
    y += LINE_H + 4;
  }
  body.push(wrap([BODY_X, y, BODY_W, LINE_H], p.wish));

  const front: PrintElement[] = [
    {
      id: '',
      type: 'IMAGE',
      x: 24,
      y: 20,
      w: 20,
      h: 20,
      field: 'school.logo',
      fit: 'CONTAIN',
      alignY: 'center',
    },
    text([50, 22, 197, 10], {
      field: bn ? 'school.name_bn' : 'school.name',
      font,
      pt: 18,
      color: c,
      weight: 700,
      align: 'center',
    }),
    text([24, 42, 120, 6], {
      text: `${bn ? 'ক্রমিক নং' : 'Serial no.'}: {{print.serial_no}}`,
      font,
      pt: 10,
      color: c,
      align: 'left',
    }),
    text([153, 42, 120, 6], {
      text: `${bn ? 'তারিখ' : 'Date'}: {{print.issue_date}}`,
      font,
      pt: 10,
      color: c,
      align: 'right',
    }),
    text([33.5, 48, 230, 14], {
      text: bn ? titleBn : titleEn,
      font,
      pt: 28,
      color: c,
      weight: 700,
      align: 'center',
    }),
    ...body,
    { id: '', type: 'QR', x: 24, y: 160, w: 24, h: 24 },
    text([52, 172, 80, 6], { field: 'print.copyLabel', font, pt: 9, color: c, align: 'left' }),
    text([150, 176, 50, 6], {
      text: bn ? 'শ্রেণি শিক্ষক' : 'Class teacher',
      font,
      pt: 10,
      color: c,
      align: 'center',
    }),
    text([213, 176, 60, 6], {
      text: bn ? 'প্রধান শিক্ষক' : 'Head teacher',
      font,
      pt: 10,
      color: c,
      align: 'center',
    }),
  ];

  return {
    key: `${slug}-a4-${lang}`,
    documentKind: kind,
    orientation: 'landscape',
    style: 'classic',
    nameKey: `print.suggestion.${slug}_a4_${lang}`,
    artwork: { front: 'certificate-a4-landscape-front.svg' },
    definition: {
      page: { widthMm: 297, heightMm: 210, sides: ['front'] },
      copyLabel: { text: 'প্রতিলিপি / DUPLICATE (copy {n})' },
      front: {
        background: { assetId: PLACEHOLDER_ASSET, print: true },
        elements: ids('front', front),
      },
    },
  };
}

export const RESULT_CERTIFICATE_SUGGESTIONS: readonly PrintSuggestion[] = (
  Object.keys(TITLES) as Kind[]
).flatMap((kind) => (['bn', 'en'] as const).map((lang) => buildCertificate(kind, lang)));

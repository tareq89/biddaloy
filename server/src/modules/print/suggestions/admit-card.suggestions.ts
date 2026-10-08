import { ADMIT_CARD_SITTING_SLOTS, DocumentKind } from '@biddaloy/shared';
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

/** 200 x 140 mm, front only: two fit on one A4 sheet (D28). Zones: artwork/README.md. */
function buildAdmitCard(lang: 'bn' | 'en'): PrintSuggestion {
  const bn = lang === 'bn';
  const font = bn ? SERIF_BN : SANS;
  const c = NAVY;
  const L = { pt: 7, color: c, align: 'left' } as const;

  const rows = [
    [bn ? 'নাম' : 'Name', bn ? 'student.name_bn' : 'student.name'],
    [bn ? 'শ্রেণি' : 'Class', 'student.class'],
    [bn ? 'শাখা' : 'Section', 'student.section'],
    [bn ? 'রোল' : 'Roll', 'student.roll'],
    [bn ? 'নিবন্ধন নং' : 'Reg. no.', 'student.registration_number'],
  ].flatMap(([label, field], i) => {
    const y = 32 + 5 * i;
    return [
      text([6, y, 22, 5], { text: `${label}:`, font, ...L }),
      text([28, y, 34, 5], { field: field as string, font, weight: 600, ...L }),
    ];
  });

  const colX = [66, 112, 136, 160, 178, 194];
  const headers = bn
    ? ['বিষয়', 'তারিখ', 'সময়', 'কক্ষ', 'আসন']
    : ['Subject', 'Date', 'Time', 'Room', 'Seat'];
  const keys = ['subject', 'date', 'time', 'room', 'seat'];
  const cell = (i: number, y: number): Rect => [
    colX[i]! + 0.5,
    y,
    colX[i + 1]! - colX[i]! - 1,
    4.5,
  ];
  const grid: PrintElement[] = [
    ...headers.map((h, i) =>
      text(cell(i, 36), { text: h, font, pt: 6, color: c, weight: 700, align: 'left' }),
    ),
    ...Array.from({ length: ADMIT_CARD_SITTING_SLOTS }, (_, r) =>
      keys.map((k, i) =>
        text(cell(i, 40.5 + 4.5 * r), {
          field: `exam.sitting.${r + 1}.${k}`,
          font,
          pt: 6,
          color: c,
          align: 'left',
        }),
      ),
    ).flat(),
  ];

  const front: PrintElement[] = [
    {
      id: '',
      type: 'IMAGE',
      x: 6,
      y: 6,
      w: 18,
      h: 18,
      field: 'school.logo',
      fit: 'CONTAIN',
      alignY: 'center',
    },
    text([27, 5, 138, 7], {
      field: bn ? 'school.name_bn' : 'school.name',
      font,
      pt: 12,
      color: c,
      weight: 700,
      align: 'left',
    }),
    text([27, 12, 138, 4], { field: 'school.address', font, pt: 6, color: c, align: 'left' }),
    text([27, 16.5, 60, 6], {
      text: bn ? 'প্রবেশপত্র' : 'ADMIT CARD',
      font,
      pt: 11,
      color: c,
      weight: 700,
      align: 'left',
    }),
    text([88, 17, 77, 5], {
      text: '{{exam.name}} — {{exam.year}}',
      font,
      pt: 8,
      color: c,
      weight: 600,
      align: 'left',
    }),
    // Seat line: both fields are empty when the sittings are in different rooms (D35).
    text([27, 23, 14, 4], { text: bn ? 'কক্ষ:' : 'Room:', font, pt: 6, color: c, align: 'left' }),
    text([41, 23, 30, 4], {
      field: 'seat.room',
      font,
      pt: 6,
      color: c,
      weight: 600,
      align: 'left',
    }),
    text([75, 23, 14, 4], { text: bn ? 'আসন:' : 'Seat:', font, pt: 6, color: c, align: 'left' }),
    text([89, 23, 30, 4], {
      field: 'seat.number',
      font,
      pt: 6,
      color: c,
      weight: 600,
      align: 'left',
    }),
    {
      id: '',
      type: 'IMAGE',
      x: 172,
      y: 5,
      w: 22,
      h: 22,
      field: 'student.photo',
      fit: 'COVER',
      alignY: 'top',
    },
    text([140, 2, 56, 3], { field: 'print.copyLabel', font, pt: 5, color: c, align: 'right' }),
    ...rows,
    ...grid,
    { id: '', type: 'QR', x: 6, y: 116, w: 18, h: 18 },
    text([28, 125, 34, 5], { field: 'print.issue_date', font, pt: 6, color: c, align: 'left' }),
    text([140, 130, 54, 5], {
      text: bn ? 'প্রধান শিক্ষকের স্বাক্ষর' : "Head teacher's signature",
      font,
      pt: 6,
      color: c,
      align: 'center',
    }),
  ];
  return {
    key: `admit-card-${lang}`,
    documentKind: DocumentKind.EXAM_ADMIT_CARD,
    orientation: 'landscape',
    style: 'classic',
    nameKey: `print.suggestion.admit_card_${lang}`,
    artwork: { front: 'admit-card-front.svg' },
    definition: {
      page: { widthMm: 200, heightMm: 140, sides: ['front'] },
      copyLabel: { text: bn ? 'কপি {n}' : 'Copy {n}' },
      front: {
        background: { assetId: PLACEHOLDER_ASSET, print: true },
        elements: ids('front', front),
      },
    },
  };
}

export const ADMIT_CARD_SUGGESTIONS: readonly PrintSuggestion[] = [
  buildAdmitCard('bn'),
  buildAdmitCard('en'),
];

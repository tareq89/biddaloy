import { DocumentKind } from '@biddaloy/shared';
import type { PrintElement } from '@biddaloy/shared';
import { NAVY, PLACEHOLDER_ASSET, SANS, SERIF_BN, ids, text } from './suggestion-helpers';
import type { PrintSuggestion } from './suggestions';

/** [71.5.01] 200 x 140 mm, front only: the admission test admit card (applicant, roll, stage date/time/venue). */
function build(lang: 'bn' | 'en'): PrintSuggestion {
  const bn = lang === 'bn';
  const font = bn ? SERIF_BN : SANS;
  const c = NAVY;
  const rows = [
    [bn ? 'নাম' : 'Name', 'applicant.name'],
    [bn ? 'রোল' : 'Roll', 'applicant.roll'],
    [bn ? 'আবেদন নং' : 'Reference', 'applicant.reference_number'],
    [bn ? 'শ্রেণি' : 'Class', 'applicant.class'],
    [bn ? 'পিতার নাম' : "Father's name", 'applicant.father_name'],
    [bn ? 'অভিভাবকের ফোন' : 'Guardian phone', 'applicant.guardian_phone'],
    [bn ? 'পরীক্ষার তারিখ' : 'Test date', 'admission.test_date'],
    [bn ? 'সময়' : 'Time', 'admission.test_time'],
    [bn ? 'কেন্দ্র' : 'Venue', 'admission.venue'],
  ].flatMap(([label, field], i) => {
    const y = 36 + 8 * i;
    return [
      text([9, y, 44, 6], { text: `${label}:`, font, pt: 8, color: c, align: 'left' }),
      text([55, y, 110, 6], {
        field: field as string,
        font,
        pt: 9,
        color: c,
        weight: 600,
        align: 'left',
      }),
    ];
  });
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
    text([27, 22.5, 138, 5], {
      text: '{{admission.round_title}} — {{admission.stage_name}}',
      font,
      pt: 8,
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
      field: 'applicant.photo',
      fit: 'COVER',
      alignY: 'top',
    },
    text([140, 2, 56, 3], { field: 'print.copyLabel', font, pt: 5, color: c, align: 'right' }),
    ...rows,
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
    key: `admission-admit-card-${lang}`,
    documentKind: DocumentKind.ADMISSION_ADMIT_CARD,
    orientation: 'landscape',
    style: 'classic',
    nameKey: `print.suggestion.admission_admit_card_${lang}`,
    artwork: { front: 'admit-card-admission-front.svg' },
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

export const ADMISSION_ADMIT_CARD_SUGGESTIONS: readonly PrintSuggestion[] = [
  build('bn'),
  build('en'),
];

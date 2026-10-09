import { ApplicationType } from '@biddaloy/shared';
import { i18n, REGION_BD_BN, REGION_BD_EN } from '@biddaloy/ui/i18n';
import { describe, expect, it } from 'vitest';

import { summarize } from './application-summary';

type Row = Parameters<typeof summarize>[0];
const row = (type: ApplicationType, extra: Partial<Row> = {}): Row => ({
  type,
  payload: {},
  start_date: null,
  end_date: null,
  ref_names: {},
  ...extra,
});

const cases: [ApplicationType, Partial<Row>, { en: string; bn: string }][] = [
  [
    ApplicationType.STAFF_LEAVE,
    { start_date: '2026-10-08', end_date: '2026-10-10' },
    { en: '8th – 10th October · 3 days', bn: '৩ দিন' },
  ],
  [
    ApplicationType.STUDENT_LEAVE,
    { start_date: '2026-10-08', end_date: '2026-10-08' },
    { en: '1 days', bn: '১ দিন' },
  ],
  [
    ApplicationType.FEE_WAIVER,
    { payload: { kind: 'PERCENT', value: 50, fee_types: ['EXAM_FEE'] } },
    { en: 'Exam fee · 50%', bn: '৫০%' },
  ],
  [
    ApplicationType.TESTIMONIAL,
    { payload: { purpose: 'Passport' } },
    { en: 'Passport', bn: 'Passport' },
  ],
  [ApplicationType.GENERAL, { payload: { subject_line: 'Hello' } }, { en: 'Hello', bn: 'Hello' }],
  [
    ApplicationType.TRANSFER_CERTIFICATE,
    { payload: { leaving_date: '2026-12-31' } },
    { en: '2026', bn: '২০২৬' },
  ],
  [
    ApplicationType.SECTION_CHANGE,
    { ref_names: { to_section_id: 'Six A' } },
    { en: 'Six A', bn: 'Six A' },
  ],
  [
    ApplicationType.READMISSION,
    { ref_names: { class_section_id: 'Seven B' } },
    { en: 'Seven B', bn: 'Seven B' },
  ],
  [ApplicationType.SCRIPT_RECHECK, { payload: { reason: 'Marks' } }, { en: 'Marks', bn: 'Marks' }],
  [ApplicationType.ID_CARD_REPRINT, { payload: { reason: 'Lost' } }, { en: 'Lost', bn: 'Lost' }],
];

describe('summarize', () => {
  it.each(cases)('%s', async (type, extra, expected) => {
    await i18n.loadNamespaces(['applicationsList', 'feeStructures']);
    for (const [lang, config] of [
      ['en', REGION_BD_EN],
      ['bn', REGION_BD_BN],
    ] as const) {
      await i18n.changeLanguage(lang);
      const t = i18n.getFixedT(lang) as never;
      expect(summarize(row(type, extra), t, config)).toContain(expected[lang]);
    }
  });
});

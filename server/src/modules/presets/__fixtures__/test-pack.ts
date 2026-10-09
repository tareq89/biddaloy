import type { PresetPack } from '@biddaloy/shared';

const t = (en: string) => ({ en, bn: en });

/** Tiny valid pack shared by every preset spec. Never registered in PRESET_PACKS. */
export const makeTestPack = (): PresetPack => ({
  id: 'test/pack',
  schemaVersion: 1,
  version: '1.0',
  country: 'BD',
  name: t('Test pack'),
  board: t('Test board'),
  description: t('Fixture'),
  verified: true,
  yearShape: { startMonth: 1 },
  stages: [
    { key: 'PRIMARY', name: t('Primary') },
    { key: 'SECONDARY', name: t('Secondary') },
  ],
  groups: ['SCIENCE'],
  classes: [
    { name: 'One', numericGrade: 1, stage: 'PRIMARY' },
    { name: 'Two', numericGrade: 2, stage: 'PRIMARY' },
    { name: 'Nine', numericGrade: 9, stage: 'SECONDARY' },
  ],
  subjects: [
    { code: 'BAN', nameEn: 'Bangla', nameBn: 'বাংলা' },
    { code: 'ENG', nameEn: 'English', nameBn: 'ইংরেজি' },
    { code: 'MAT', nameEn: 'Mathematics', nameBn: 'গণিত' },
    { code: 'PHY', nameEn: 'Physics', nameBn: 'পদার্থবিজ্ঞান' },
  ],
  classSubjects: [
    { classGrade: 1, subjectCode: 'BAN' },
    { classGrade: 2, subjectCode: 'ENG' },
    { classGrade: 9, subjectCode: 'MAT' },
    // group-only subject
    { classGrade: 9, subjectCode: 'PHY', group: 'SCIENCE' },
  ],
  gradingScale: {
    name: 'GPA',
    bands: [
      { from: 0, to: 32, grade: 'F', gpa: 0, isFail: true },
      { from: 33, to: 79, grade: 'B', gpa: 3, isFail: false },
      { from: 80, to: 100, grade: 'A+', gpa: 5, isFail: false },
    ],
  },
  terms: [{ name: 'Term 1', seq: 1, start: { month: 1, day: 1 }, end: { month: 6, day: 30 } }],
  examTemplates: [
    {
      name: 'Final',
      kind: 'TERM',
      rows: [
        {
          classGrade: 1,
          subjectCode: 'BAN',
          components: [{ name: 'Written', kind: 'WRITTEN', full: 100, pass: 33 }],
        },
      ],
    },
  ],
  certificates: ['TESTIMONIAL'],
});

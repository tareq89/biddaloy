import type { PresetPack } from '@biddaloy/shared';

/**
 * Cambridge International pack (Checkpoint, IGCSE / O Level, AS / A Level).
 *
 * UNVERIFIED / ILLUSTRATIVE (pack is `verified: false`):
 * - ILLUSTRATIVE PERCENT BANDS — edit per session. Real Cambridge grade
 *   boundaries change every session. The 9-1 scale is not modelled (IGCSE lets
 *   each school choose 9-1 or A*-G); schools using 9-1 edit the scale.
 * - ONE scale (A*-E, U) is used for the whole pack. IGCSE also awards F and G
 *   (add bands if used); AS / A Level stops at E; Checkpoint has no letter grades.
 * - Years 10-13 subjects are TYPICAL, NOT EXHAUSTIVE — schools add their own.
 * - Bangla subject/stage names are translations, not official Cambridge terms.
 * - Exam templates, terms, groups and versions are intentionally empty:
 *   papers and component weights vary per syllabus.
 * Verified: Checkpoint covers English, Mathematics, Science only.
 */
const t = (en: string, bn: string) => ({ en, bn });

const SCIENCE = 'C-3';
const TYPICAL_SENIOR = ['C-4', 'C-5', 'C-6', 'C-7', 'C-8', 'C-9', 'C-10', 'C-11', 'C-12'];

export const CAMBRIDGE_PACK: PresetPack = {
  id: 'intl/cambridge',
  schemaVersion: 1,
  version: '2026.1',
  country: 'INTL',
  name: t('Cambridge International', 'ক্যামব্রিজ ইন্টারন্যাশনাল'),
  board: t('Cambridge International Education', 'ক্যামব্রিজ ইন্টারন্যাশনাল এডুকেশন'),
  description: t(
    'Checkpoint, IGCSE / O Level and AS / A Level, Years 1-13, letter grades without GPA. Percent bands are illustrative; edit them per exam session.',
    'চেকপয়েন্ট, আইজিসিএসই / ও লেভেল এবং এএস / এ লেভেল, ইয়ার ১-১৩, জিপিএ ছাড়া লেটার গ্রেড। শতকরা সীমা উদাহরণমাত্র; প্রতিটি পরীক্ষার সেশন অনুযায়ী পরিবর্তন করুন।',
  ),
  verified: false,
  yearShape: { startMonth: 1 },
  stages: [
    { key: 'PRIMARY', name: t('Primary', 'প্রাইমারি') },
    { key: 'LOWER_SECONDARY', name: t('Lower Secondary', 'লোয়ার সেকেন্ডারি') },
    { key: 'IGCSE_O_LEVEL', name: t('IGCSE / O Level', 'আইজিসিএসই / ও লেভেল') },
    { key: 'AS_A_LEVEL', name: t('AS / A Level', 'এএস / এ লেভেল') },
  ],
  groups: [],
  classes: Array.from({ length: 13 }, (_, i) => {
    const n = i + 1;
    const stage =
      n <= 6 ? 'PRIMARY' : n <= 9 ? 'LOWER_SECONDARY' : n <= 11 ? 'IGCSE_O_LEVEL' : 'AS_A_LEVEL';
    return { name: `Year ${n}`, numericGrade: n, stage };
  }),
  subjects: [
    { code: 'C-1', nameEn: 'English', nameBn: 'ইংরেজি' },
    { code: 'C-2', nameEn: 'Mathematics', nameBn: 'গণিত' },
    { code: SCIENCE, nameEn: 'Science', nameBn: 'বিজ্ঞান' },
    // TYPICAL, NOT EXHAUSTIVE
    { code: 'C-4', nameEn: 'English Language', nameBn: 'ইংরেজি ভাষা' },
    { code: 'C-5', nameEn: 'Mathematics (Senior)', nameBn: 'গণিত (সিনিয়র)' },
    { code: 'C-6', nameEn: 'Physics', nameBn: 'পদার্থবিজ্ঞান' },
    { code: 'C-7', nameEn: 'Chemistry', nameBn: 'রসায়ন' },
    { code: 'C-8', nameEn: 'Biology', nameBn: 'জীববিজ্ঞান' },
    { code: 'C-9', nameEn: 'Computer Science', nameBn: 'কম্পিউটার সায়েন্স' },
    { code: 'C-10', nameEn: 'Economics', nameBn: 'অর্থনীতি' },
    { code: 'C-11', nameEn: 'Business Studies', nameBn: 'ব্যবসায় শিক্ষা' },
    { code: 'C-12', nameEn: 'Accounting', nameBn: 'হিসাববিজ্ঞান' },
  ],
  classSubjects: [
    ...Array.from({ length: 9 }, (_, i) =>
      ['C-1', 'C-2', SCIENCE].map((subjectCode) => ({ classGrade: i + 1, subjectCode })),
    ).flat(),
    ...[10, 11, 12, 13].flatMap((classGrade) =>
      TYPICAL_SENIOR.map((subjectCode) => ({ classGrade, subjectCode })),
    ),
  ],
  gradingScale: {
    name: 'Cambridge letter grades',
    bands: [
      { from: 0, to: 39, grade: 'U', gpa: null, isFail: true },
      { from: 40, to: 49, grade: 'E', gpa: null, isFail: false },
      { from: 50, to: 59, grade: 'D', gpa: null, isFail: false },
      { from: 60, to: 69, grade: 'C', gpa: null, isFail: false },
      { from: 70, to: 79, grade: 'B', gpa: null, isFail: false },
      { from: 80, to: 89, grade: 'A', gpa: null, isFail: false },
      { from: 90, to: 100, grade: 'A*', gpa: null, isFail: false },
    ],
  },
  terms: [],
  examTemplates: [],
  certificates: [],
};

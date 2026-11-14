import type { InstitutionKind, KindChanges } from './use-institution-kinds';

/** Eight kinds shaped like `GET /institution-kinds` (tests and stories). Qawmi, College and Technical are unverified (D25). */
export const KIND_FIXTURES: InstitutionKind[] = [
  ['primary', 'Primary school', 'প্রাথমিক বিদ্যালয়', true],
  ['secondary', 'Secondary school', 'মাধ্যমিক বিদ্যালয়', true],
  ['college', 'College', 'কলেজ', false],
  ['alia-madrasa', 'Alia madrasa', 'আলিয়া মাদ্রাসা', true],
  ['qawmi-madrasa', 'Qawmi madrasa', 'কওমি মাদ্রাসা', false],
  ['english-medium', 'English medium', 'ইংলিশ মিডিয়াম', true],
  ['coaching', 'Coaching centre', 'কোচিং সেন্টার', true],
  ['technical', 'Technical institute', 'কারিগরি প্রতিষ্ঠান', false],
].map(([id, en, bn, verified]) => ({
  id: id as string,
  name: { en: en as string, bn: bn as string },
  verified: verified as boolean,
  modules: {},
  labels: {},
}));

/** What applying `coaching` to a default school changes. */
export const COACHING_CHANGES: KindChanges = {
  modules: [
    { key: 'fines', from: true, to: false },
    { key: 'programs', from: true, to: false },
    { key: 'fees', from: false, to: true },
  ],
  labels: [
    {
      key: 'section',
      from: null,
      to: { en: { one: 'Batch', other: 'Batches' }, bn: 'ব্যাচ' },
    },
    {
      key: 'class',
      from: { en: { one: 'Grade', other: 'Grades' }, bn: 'গ্রেড' },
      to: { en: { one: 'Course', other: 'Courses' }, bn: 'কোর্স' },
    },
  ],
};

export const NO_CHANGES: KindChanges = { modules: [], labels: [] };

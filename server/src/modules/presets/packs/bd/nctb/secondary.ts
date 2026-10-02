/**
 * NCTB classes 9-12 (stage SECONDARY 9-10, HIGHER_SECONDARY 11-12). Part 2 of
 * the bd/nctb pack; index.ts spreads primary.ts first, then this.
 *
 * Sources: https://en.wikipedia.org/wiki/Secondary_School_Certificate_(Bangladesh)
 * (SSC group/compulsory structure and the GPA table, as cited by the ticket).
 * Fetch date: none. Nothing was re-fetched when this was written (2026-10-02);
 * the structure below is taken from the ticket.
 *
 * Naming: the 2012 curriculum is used for every class 9-12 name (still in force
 * for secondary). NOTE: primary.ts (#1275) classes 6-8 Bangla names mix
 * 2022-era titles; not edited here, owned by #1275.
 *
 * Codes: primary.ts codes are reused where the subject is the same (BAN, ENG,
 * MATH, P-01..P-04 religions, P-05 BGS, P-07 ICT, P-10 Agriculture, P-11 Home
 * Science). New subjects use our own stable `S-<n>` (classes 9-10) and `H-<n>`
 * (classes 11-12) codes, unique across the whole pack. The official board
 * subject codes (e.g. HSC Physics 174/175) were NOT confirmed against a board
 * PDF, so they are not used. UNVERIFIED: every S-/H- code.
 *
 * UNVERIFIED:
 *  - Humanities group subjects at 11-12 (Economics, Civics and Good Governance,
 *    Social Work): the ticket only says "as the board lists".
 *  - Exam template marks: only Physics (classes 9-10) has a row, with the
 *    commonly cited split MCQ 25 / written 50 / practical 25 and pass marks of
 *    8 / 17 / 8 (~33%). Not checked against a board PDF. Every other subject's
 *    row is OMITTED (distribution not found) - never invented.
 *
 * Model limits (one ClassSubject per class+subject, and `group` XOR `optional`):
 *  - "Higher Mathematics optional for non-Science" at 9-10 is NOT expressible
 *    (it is group-only for Science); omitted.
 *  - "Religion & Moral Education" at 9-10 is modelled as the four religion
 *    subjects P-01..P-04 (school picks per student), same as primary.ts.
 *  - "General Mathematics" at 9-10 reuses MATH ("Mathematics").
 *  - 11-12 Higher Mathematics is the optional 4th subject; Biology is the
 *    Science group-only subject.
 */
import type { PresetPack } from '@biddaloy/shared';

import { NCTB_COMMON_SUBJECTS } from './primary';

type Subject = PresetPack['subjects'][number];
type ClassSubject = PresetPack['classSubjects'][number];

const { BAN, ENG, MATH } = NCTB_COMMON_SUBJECTS;

/** Subjects already defined in primary.ts, reused by code so the pack stays unique. */
const REUSED = {
  RELIGIONS: ['P-01', 'P-02', 'P-03', 'P-04'],
  BGS: 'P-05',
  ICT: 'P-07',
  AGRI: 'P-10',
  HOME: 'P-11',
} as const;

const NEW_SUBJECTS: Subject[] = [
  { code: 'S-01', nameEn: 'Physics', nameBn: 'পদার্থবিজ্ঞান' },
  { code: 'S-02', nameEn: 'Chemistry', nameBn: 'রসায়ন' },
  { code: 'S-03', nameEn: 'Biology', nameBn: 'জীববিজ্ঞান' },
  { code: 'S-04', nameEn: 'Higher Mathematics', nameBn: 'উচ্চতর গণিত' },
  {
    code: 'S-05',
    nameEn: 'History of Bangladesh and World Civilization',
    nameBn: 'বাংলাদেশের ইতিহাস ও বিশ্বসভ্যতা',
  },
  { code: 'S-06', nameEn: 'Geography and Environment', nameBn: 'ভূগোল ও পরিবেশ' },
  { code: 'S-07', nameEn: 'Civics and Citizenship', nameBn: 'পৌরনীতি ও নাগরিকতা' },
  { code: 'S-08', nameEn: 'Economics', nameBn: 'অর্থনীতি' },
  { code: 'S-09', nameEn: 'Accounting', nameBn: 'হিসাববিজ্ঞান' },
  { code: 'S-10', nameEn: 'Finance and Banking', nameBn: 'ফিন্যান্স ও ব্যাংকিং' },
  { code: 'S-11', nameEn: 'Business Entrepreneurship', nameBn: 'ব্যবসায় উদ্যোগ' },
  { code: 'H-01', nameEn: 'Physics (HSC)', nameBn: 'পদার্থবিজ্ঞান (এইচএসসি)' },
  { code: 'H-02', nameEn: 'Chemistry (HSC)', nameBn: 'রসায়ন (এইচএসসি)' },
  { code: 'H-03', nameEn: 'Biology (HSC)', nameBn: 'জীববিজ্ঞান (এইচএসসি)' },
  { code: 'H-04', nameEn: 'Higher Mathematics (HSC)', nameBn: 'উচ্চতর গণিত (এইচএসসি)' },
  { code: 'H-05', nameEn: 'Accounting (HSC)', nameBn: 'হিসাববিজ্ঞান (এইচএসসি)' },
  {
    code: 'H-06',
    nameEn: 'Business Organisation and Management',
    nameBn: 'ব্যবসায় সংগঠন ও ব্যবস্থাপনা',
  },
  { code: 'H-07', nameEn: 'Finance and Banking (HSC)', nameBn: 'ফিন্যান্স ও ব্যাংকিং (এইচএসসি)' },
  { code: 'H-08', nameEn: 'Economics (HSC)', nameBn: 'অর্থনীতি (এইচএসসি)' },
  { code: 'H-09', nameEn: 'Civics and Good Governance', nameBn: 'পৌরনীতি ও সুশাসন' },
  { code: 'H-10', nameEn: 'Social Work', nameBn: 'সমাজকর্ম' },
];

export const NCTB_GROUPS = ['Science', 'Humanities', 'Business Studies'] as const;

const all = (grades: number[], codes: readonly string[], extra: Partial<ClassSubject> = {}) =>
  grades.flatMap((g) => codes.map((c) => ({ classGrade: g, subjectCode: c, ...extra })));
const inGroup = (grades: number[], group: string, codes: string[]) => all(grades, codes, { group });

const G910 = [9, 10];
const G1112 = [11, 12];

const classSubjects: ClassSubject[] = [
  // 9-10 compulsory (optional:false: school picks the religion per student).
  ...all(G910, [BAN.code, ENG.code, MATH.code, REUSED.BGS, ...REUSED.RELIGIONS, REUSED.ICT], {
    optional: false,
  }),
  ...inGroup(G910, 'Science', ['S-01', 'S-02', 'S-03', 'S-04']),
  ...inGroup(G910, 'Humanities', ['S-05', 'S-06', 'S-07', 'S-08']),
  ...inGroup(G910, 'Business Studies', ['S-09', 'S-10', 'S-11']),
  ...all(G910, [REUSED.AGRI, REUSED.HOME], { optional: true }),
  // 11-12.
  ...all(G1112, [BAN.code, ENG.code, REUSED.ICT], { optional: false }),
  ...inGroup(G1112, 'Science', ['H-01', 'H-02', 'H-03']),
  ...inGroup(G1112, 'Business Studies', ['H-05', 'H-06', 'H-07']),
  ...inGroup(G1112, 'Humanities', ['H-08', 'H-09', 'H-10']),
  ...all(G1112, ['H-04'], { optional: true }),
];

// UNVERIFIED marks split: see header. Physics is the only subject with a row.
const physics = (classGrade: number) => ({
  classGrade,
  subjectCode: 'S-01',
  components: [
    { name: 'MCQ', kind: 'MCQ' as const, full: 25, pass: 8 },
    { name: 'Written', kind: 'WRITTEN' as const, full: 50, pass: 17 },
    { name: 'Practical', kind: 'PRACTICAL' as const, full: 25, pass: 8 },
  ],
});

const template = (name: string) => ({
  name,
  kind: 'TERM' as const,
  rows: G910.map(physics),
});

export const NCTB_SECONDARY: Pick<
  PresetPack,
  'classes' | 'subjects' | 'classSubjects' | 'examTemplates' | 'gradingScale'
> = {
  classes: [9, 10, 11, 12].map((g) => ({
    name: `Class ${g}`,
    numericGrade: g,
    stage: g <= 10 ? 'SECONDARY' : 'HIGHER_SECONDARY',
  })),
  subjects: NEW_SUBJECTS,
  classSubjects,
  examTemplates: [template('Annual exam'), template('Half-yearly exam')],
  // Ticket table (Wikipedia SSC article), ascending as validatePresetPack requires.
  gradingScale: {
    name: 'SSC/HSC GPA scale',
    bands: [
      { from: 0, to: 32, grade: 'F', gpa: 0, isFail: true },
      { from: 33, to: 39, grade: 'D', gpa: 1, isFail: false },
      { from: 40, to: 49, grade: 'C', gpa: 2, isFail: false },
      { from: 50, to: 59, grade: 'B', gpa: 3, isFail: false },
      { from: 60, to: 69, grade: 'A-', gpa: 3.5, isFail: false },
      { from: 70, to: 79, grade: 'A', gpa: 4, isFail: false },
      { from: 80, to: 100, grade: 'A+', gpa: 5, isFail: false },
    ],
  },
};

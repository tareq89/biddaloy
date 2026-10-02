/**
 * Alia Madrasa pack: Bangladesh Madrasah Education Board.
 *
 * Sources:
 *  - https://en.wikipedia.org/wiki/Bangladesh_Madrasah_Education_Board
 *  - https://en.wikipedia.org/wiki/Dakhil_examination (SSC-equivalent since 1985)
 *  - https://en.wikipedia.org/wiki/Alim_examination (HSC-equivalent since 1987;
 *    science and arts, business/technical added)
 *
 * Verified: stage names and lengths (Ebtedayee 5y, Dakhil 5y, Alim 2y, Fazil 2y,
 * Kamil 2y), the three groups, the Dakhil/Alim GPA 5.00 scale.
 *
 * UNVERIFIED (the board syllabus at http://www.educationboard.gov.bd/madrasah/
 * was not available to confirm per-class subject lists), so `verified: false`:
 *  - which subjects are taught in which class (every `classSubjects` row)
 *  - the subjects attached to each group
 *  - Arabic 1st/2nd paper split, taken from the ticket
 *  - Fazil/Kamil subjects (none seeded) and exam templates (none seeded)
 */
import type { PresetPack, PresetGradeBand } from '@biddaloy/shared';

// Copied from the SSC/HSC scale on purpose: packs must not import each other.
const GPA_BANDS: PresetGradeBand[] = [
  { from: 0, to: 32, grade: 'F', gpa: 0, isFail: true },
  { from: 33, to: 39, grade: 'D', gpa: 1, isFail: false },
  { from: 40, to: 49, grade: 'C', gpa: 2, isFail: false },
  { from: 50, to: 59, grade: 'B', gpa: 3, isFail: false },
  { from: 60, to: 69, grade: 'A-', gpa: 3.5, isFail: false },
  { from: 70, to: 79, grade: 'A', gpa: 4, isFail: false },
  { from: 80, to: 100, grade: 'A+', gpa: 5, isFail: false },
];

const range = (a: number, b: number) => Array.from({ length: b - a + 1 }, (_, i) => a + i);

/** Subjects every class from `from` to `to` takes (UNVERIFIED allocation). */
const common = (codes: string[], from: number, to: number) =>
  range(from, to).flatMap((classGrade) =>
    codes.map((subjectCode) => ({ classGrade, subjectCode })),
  );

/** Group-only subjects for grades 9-12 (UNVERIFIED allocation). */
const grouped = (group: string, codes: string[]) =>
  [9, 10, 11, 12].flatMap((classGrade) =>
    codes.map((subjectCode) => ({ classGrade, subjectCode, group })),
  );

export const ALIA_PACK: PresetPack = {
  id: 'bd/alia-madrasa',
  schemaVersion: 1,
  version: '2026.1',
  country: 'BD',
  name: { en: 'Alia Madrasa', bn: 'আলিয়া মাদ্রাসা' },
  board: {
    en: 'Bangladesh Madrasah Education Board',
    bn: 'বাংলাদেশ মাদ্রাসা শিক্ষা বোর্ড',
  },
  description: {
    en: 'Alia madrasa stages from Ebtedayee through Kamil. Subject allocation is a starting point; review it against the Madrasah Board syllabus.',
    bn: 'ইবতেদায়ি, দাখিল, আলিম, ফাযিল ও কামিল স্তরের পাঠ্যক্রম।',
  },
  verified: false,
  // Weekly-off (Friday) lives in attendance settings, not RegionSettings; see ticket drift note.
  region: { country: 'BD', timezone: 'Asia/Dhaka' },
  yearShape: { startMonth: 1 },
  stages: [
    { key: 'EBTEDAYEE', name: { en: 'Ebtedayee', bn: 'ইবতেদায়ি' } },
    { key: 'DAKHIL', name: { en: 'Dakhil', bn: 'দাখিল' } },
    { key: 'ALIM', name: { en: 'Alim', bn: 'আলিম' } },
    { key: 'FAZIL', name: { en: 'Fazil', bn: 'ফাযিল' } },
    { key: 'KAMIL', name: { en: 'Kamil', bn: 'কামিল' } },
  ],
  groups: ['Science', 'Humanities', 'Business Studies'],
  classes: [
    ...range(1, 5).map((n) => ({ name: `Class ${n}`, numericGrade: n, stage: 'EBTEDAYEE' })),
    ...range(6, 10).map((n) => ({ name: `Class ${n}`, numericGrade: n, stage: 'DAKHIL' })),
    ...range(11, 12).map((n) => ({ name: `Class ${n}`, numericGrade: n, stage: 'ALIM' })),
    { name: 'Fazil 1st Year', numericGrade: 13, stage: 'FAZIL' },
    { name: 'Fazil 2nd Year', numericGrade: 14, stage: 'FAZIL' },
    { name: 'Kamil 1st Year', numericGrade: 15, stage: 'KAMIL' },
    { name: 'Kamil 2nd Year', numericGrade: 16, stage: 'KAMIL' },
  ],
  subjects: [
    { code: 'QUR', nameEn: 'Quran Majid & Tajwid', nameBn: 'কুরআন মাজিদ ও তাজবিদ' },
    { code: 'AQF', nameEn: 'Aqaid & Fiqh', nameBn: 'আকাইদ ও ফিকহ' },
    { code: 'HAD', nameEn: 'Hadith', nameBn: 'হাদিস শরিফ' },
    { code: 'ARB1', nameEn: 'Arabic 1st Paper', nameBn: 'আরবি প্রথম পত্র' },
    { code: 'ARB2', nameEn: 'Arabic 2nd Paper', nameBn: 'আরবি দ্বিতীয় পত্র' },
    { code: 'BAN', nameEn: 'Bangla', nameBn: 'বাংলা' },
    { code: 'ENG', nameEn: 'English', nameBn: 'ইংরেজি' },
    { code: 'MAT', nameEn: 'Mathematics', nameBn: 'গণিত' },
    { code: 'ICT', nameEn: 'ICT', nameBn: 'তথ্য ও যোগাযোগ প্রযুক্তি' },
    { code: 'BGS', nameEn: 'Bangladesh & Global Studies', nameBn: 'বাংলাদেশ ও বিশ্বপরিচয়' },
    { code: 'PHY', nameEn: 'Physics', nameBn: 'পদার্থবিজ্ঞান' },
    { code: 'CHE', nameEn: 'Chemistry', nameBn: 'রসায়ন' },
    { code: 'BIO', nameEn: 'Biology', nameBn: 'জীববিজ্ঞান' },
    { code: 'HMT', nameEn: 'Higher Mathematics', nameBn: 'উচ্চতর গণিত' },
    { code: 'GSC', nameEn: 'General Science', nameBn: 'সাধারণ বিজ্ঞান' },
    { code: 'ISH', nameEn: 'Islamic History & Culture', nameBn: 'ইসলামের ইতিহাস ও সংস্কৃতি' },
    { code: 'LOG', nameEn: 'Logic', nameBn: 'যুক্তিবিদ্যা' },
    { code: 'ECO', nameEn: 'Economics', nameBn: 'অর্থনীতি' },
    { code: 'ACC', nameEn: 'Accounting', nameBn: 'হিসাববিজ্ঞান' },
    {
      code: 'BOR',
      nameEn: 'Business Organisation & Management',
      nameBn: 'ব্যবসায় সংগঠন ও ব্যবস্থাপনা',
    },
  ],
  // UNVERIFIED: whole allocation below, see header.
  classSubjects: [
    ...common(['QUR', 'AQF', 'ARB1', 'BAN', 'ENG', 'MAT'], 1, 5),
    ...common(['QUR', 'AQF', 'HAD', 'ARB1', 'ARB2', 'BAN', 'ENG', 'MAT', 'ICT', 'BGS'], 6, 8),
    ...common(['GSC'], 6, 8),
    ...common(['QUR', 'AQF', 'HAD', 'ARB1', 'ARB2', 'BAN', 'ENG', 'ICT'], 9, 12),
    ...common(['MAT'], 9, 10),
    ...common(['BGS'], 9, 10),
    ...grouped('Science', ['PHY', 'CHE', 'BIO', 'HMT']),
    ...grouped('Humanities', ['ISH', 'LOG', 'ECO']),
    ...grouped('Business Studies', ['ACC', 'BOR']),
  ],
  gradingScale: { name: 'Dakhil/Alim GPA 5.00', bands: GPA_BANDS },
  terms: [],
  // UNVERIFIED: per-subject marks distribution not found, so none seeded.
  examTemplates: [],
  certificates: ['TESTIMONIAL', 'TRANSCRIPT', 'CHARACTER', 'TRANSFER'],
};

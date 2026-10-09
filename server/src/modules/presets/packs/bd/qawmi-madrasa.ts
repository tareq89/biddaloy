import type { PresetPack } from '@biddaloy/shared';

/**
 * Qawmi madrasa pack (Epic 35.0, #1278). STRUCTURE AND SUBJECTS ONLY.
 *
 * `verified: false` (D25): marks, grading scale, exam templates and terms
 * are deliberately blank. The school sets them; nothing here is invented.
 *
 * Sources: en.wikipedia.org/wiki/Qawmi_madrasa and
 * en.wikipedia.org/wiki/Befaqul_Madarisil_Arabia_Bangladesh (stage names).
 *
 * Left out on purpose:
 *  - TAHFEEZ (Qur'an memorisation) is a programme (Epic 34), not a stage.
 *
 * Weekly-off: apply does not write attendance settings; every tenant already
 * defaults to Friday (#1280).
 *
 * UNVERIFIED (not documented in the sources, so not guessed):
 *  - Years per stage: one class per stage. Real boards run several years
 *    per stage and their syllabi differ (~6 boards).
 *  - Subject-to-class mapping (`classSubjects` is empty).
 *  - Subject codes: none exist publicly; `Q-<n>` are our own.
 *  - Which subjects each board teaches at each stage.
 *  - Academic year start month (1 = January is an assumption).
 */
export const QAWMI_PACK: PresetPack = {
  id: 'bd/qawmi-madrasa',
  schemaVersion: 1,
  version: '2026.1',
  country: 'BD',
  name: { en: 'Qawmi Madrasa', bn: 'কওমি মাদ্রাসা' },
  board: { en: 'Qawmi madrasa boards', bn: 'কওমি মাদ্রাসা বোর্ডসমূহ' },
  description: {
    en: 'Qawmi madrasa stages and core subjects. Marks and grading scale are set by the school.',
    bn: 'কওমি মাদ্রাসার স্তর ও মূল বিষয়সমূহ। নম্বর ও গ্রেডিং স্কেল স্কুল নিজে নির্ধারণ করবে।',
  },
  verified: false,
  yearShape: { startMonth: 1 },
  stages: [
    { key: 'IBTEDAYI', name: { en: 'Ibtedayi', bn: 'ইবতেদায়ী' } },
    { key: 'MUTAWASSITAH', name: { en: 'Mutawassitah', bn: 'মুতাওয়াসসিতা' } },
    { key: 'SANAWIYYA_AMMAH', name: { en: 'Sanawiyya Ammah', bn: 'সানাবিয়্যাহ আম্মাহ' } },
    { key: 'SANAWIYYA_KHASSAH', name: { en: 'Sanawiyya Khassah', bn: 'সানাবিয়্যাহ খাসসাহ' } },
    { key: 'FAZILAT', name: { en: 'Fazilat', bn: 'ফযিলত' } },
    { key: 'TAKMIL', name: { en: 'Takmil (Dawra-e-Hadith)', bn: 'তাকমিল (দাওরায়ে হাদীস)' } },
  ],
  groups: [],
  classes: [
    { name: 'Ibtedayi', numericGrade: 1, stage: 'IBTEDAYI' },
    { name: 'Mutawassitah', numericGrade: 2, stage: 'MUTAWASSITAH' },
    { name: 'Sanawiyya Ammah', numericGrade: 3, stage: 'SANAWIYYA_AMMAH' },
    { name: 'Sanawiyya Khassah', numericGrade: 4, stage: 'SANAWIYYA_KHASSAH' },
    { name: 'Fazilat', numericGrade: 5, stage: 'FAZILAT' },
    { name: 'Takmil', numericGrade: 6, stage: 'TAKMIL' },
  ],
  subjects: [
    { code: 'Q-1', nameEn: "Qur'an and Tajwid", nameBn: 'কুরআন ও তাজবীদ' },
    { code: 'Q-2', nameEn: 'Hadith', nameBn: 'হাদীস' },
    { code: 'Q-3', nameEn: 'Fiqh', nameBn: 'ফিকহ' },
    { code: 'Q-4', nameEn: 'Arabic Language and Literature', nameBn: 'আরবি ভাষা ও সাহিত্য' },
    { code: 'Q-5', nameEn: 'Mantiq (Logic)', nameBn: 'মানতিক (যুক্তিবিদ্যা)' },
    { code: 'Q-6', nameEn: 'Bangla', nameBn: 'বাংলা' },
    { code: 'Q-7', nameEn: 'Mathematics', nameBn: 'গণিত' },
    { code: 'Q-8', nameEn: 'English', nameBn: 'ইংরেজি' },
  ],
  classSubjects: [],
  gradingScale: null,
  terms: [],
  examTemplates: [],
  certificates: ['TESTIMONIAL', 'TRANSCRIPT', 'CHARACTER', 'TRANSFER'],
};

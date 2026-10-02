/**
 * Assembled `bd/nctb` pack: classes 1-8 (primary.ts) + 9-12 (secondary.ts).
 * `verified` is false: see the UNVERIFIED lists in primary.ts and secondary.ts.
 * Registry wiring is #1280's job.
 */
import type { PresetPack } from '@biddaloy/shared';

import { NCTB_PRIMARY } from './primary';
import { NCTB_GROUPS, NCTB_SECONDARY } from './secondary';

export const NCTB_PACK: PresetPack = {
  id: 'bd/nctb',
  schemaVersion: 1,
  version: '2026.1',
  country: 'BD',
  name: { en: 'Bangladesh NCTB curriculum', bn: 'বাংলাদেশ এনসিটিবি পাঠ্যক্রম' },
  board: {
    en: 'National Curriculum and Textbook Board (NCTB)',
    bn: 'জাতীয় শিক্ষাক্রম ও পাঠ্যপুস্তক বোর্ড (এনসিটিবি)',
  },
  description: {
    en: 'Classes 1-12 with Science, Humanities and Business Studies groups at 9-12 and the SSC/HSC GPA scale.',
    bn: 'প্রথম থেকে দ্বাদশ শ্রেণি, নবম-দ্বাদশে বিজ্ঞান, মানবিক ও ব্যবসায় শিক্ষা বিভাগ এবং এসএসসি/এইচএসসি জিপিএ স্কেল।',
  },
  verified: false,
  // ponytail: RegionSettings has no weekly-off-day field (it lives in attendance policy), so only locale/country/timezone here.
  region: { country: 'BD', locale: 'bn-BD', timezone: 'Asia/Dhaka' },
  yearShape: { startMonth: 1 },
  stages: [
    { key: 'PRIMARY', name: { en: 'Primary', bn: 'প্রাথমিক' } },
    { key: 'JUNIOR', name: { en: 'Junior', bn: 'নিম্ন মাধ্যমিক' } },
    { key: 'SECONDARY', name: { en: 'Secondary', bn: 'মাধ্যমিক' } },
    { key: 'HIGHER_SECONDARY', name: { en: 'Higher Secondary', bn: 'উচ্চ মাধ্যমিক' } },
  ],
  versions: [
    { key: 'bangla', name: { en: 'Bangla', bn: 'বাংলা' } },
    { key: 'english', name: { en: 'English', bn: 'ইংরেজি' } },
  ],
  groups: [...NCTB_GROUPS],
  classes: [...NCTB_PRIMARY.classes, ...NCTB_SECONDARY.classes],
  subjects: [...NCTB_PRIMARY.subjects, ...NCTB_SECONDARY.subjects],
  classSubjects: [...NCTB_PRIMARY.classSubjects, ...NCTB_SECONDARY.classSubjects],
  gradingScale: NCTB_SECONDARY.gradingScale,
  terms: [],
  examTemplates: NCTB_SECONDARY.examTemplates,
  certificates: ['TESTIMONIAL', 'TRANSCRIPT', 'CHARACTER', 'TRANSFER'],
};

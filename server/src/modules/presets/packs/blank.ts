import type { PresetPack } from '@biddaloy/shared';

/** Blank pack (Epic 35.0, #1280): applying it creates the academic year and the preset block, nothing else. */
export const BLANK_PACK: PresetPack = {
  id: 'blank',
  schemaVersion: 1,
  version: '2026.1',
  country: 'INTL',
  name: { en: 'Blank / custom setup', bn: 'কাস্টম সেটআপ' },
  board: { en: 'None', bn: 'কোনোটি নয়' },
  description: {
    en: 'Start with no classes or subjects and set up everything yourself.',
    bn: 'কোনো শ্রেণি বা বিষয় ছাড়া শুরু করুন; সবকিছু নিজে সাজিয়ে নিন।',
  },
  verified: true,
  yearShape: { startMonth: 1 },
  stages: [{ key: 'ALL', name: { en: 'All', bn: 'সব' } }],
  groups: [],
  classes: [],
  subjects: [],
  classSubjects: [],
  gradingScale: null,
  terms: [],
  examTemplates: [],
  certificates: [],
};

/**
 * NCTB classes 1-8 (stages PRIMARY 1-5, JUNIOR 6-8). Part 1 of the bd/nctb pack;
 * #1276 merges this with classes 9-12 and defines the pack-level stages.
 *
 * Sources: NCTB textbook catalogue, https://nctb.gov.bd (textbook list per class).
 * Fetch date: none. The catalogue could NOT be fetched when this was written
 * (2026-10-02); the subject lists below are from the standard NCTB class 1-8
 * structure and every per-class list is UNVERIFIED against the live catalogue.
 * Re-check each class before flipping the pack-level `verified` flag in #1276.
 *
 * Codes: the board assigns no subject codes for classes 1-8, so `P-<n>` codes
 * are our own and stable. BAN / ENG / MATH are shared across classes 1-12.
 *
 * gradedOnly is intentionally unset everywhere: no source seen marks any
 * subject non-examinable.
 */
import type { PresetPack } from '@biddaloy/shared';

type Subject = PresetPack['subjects'][number];

/** One code across ALL classes 1-12; #1276 imports these for the secondary half. */
export const NCTB_COMMON_SUBJECTS = {
  BAN: { code: 'BAN', nameEn: 'Bangla', nameBn: 'বাংলা' },
  ENG: { code: 'ENG', nameEn: 'English', nameBn: 'ইংরেজি' },
  MATH: { code: 'MATH', nameEn: 'Mathematics', nameBn: 'গণিত' },
} as const satisfies Record<string, Subject>;

const S = {
  ...NCTB_COMMON_SUBJECTS,
  ISLAM: { code: 'P-01', nameEn: 'Islam and Moral Education', nameBn: 'ইসলাম ও নৈতিক শিক্ষা' },
  HINDU: {
    code: 'P-02',
    nameEn: 'Hindu Religion and Moral Education',
    nameBn: 'হিন্দুধর্ম ও নৈতিক শিক্ষা',
  },
  BUDDHIST: {
    code: 'P-03',
    nameEn: 'Buddhist Religion and Moral Education',
    nameBn: 'বৌদ্ধধর্ম ও নৈতিক শিক্ষা',
  },
  CHRISTIAN: {
    code: 'P-04',
    nameEn: 'Christian Religion and Moral Education',
    nameBn: 'খ্রিস্টধর্ম ও নৈতিক শিক্ষা',
  },
  BGS: { code: 'P-05', nameEn: 'Bangladesh and Global Studies', nameBn: 'বাংলাদেশ ও বিশ্বপরিচয়' },
  SCI: { code: 'P-06', nameEn: 'Science', nameBn: 'বিজ্ঞান' },
  ICT: {
    code: 'P-07',
    nameEn: 'Information and Communication Technology',
    nameBn: 'তথ্য ও যোগাযোগ প্রযুক্তি',
  },
  ARTS: { code: 'P-08', nameEn: 'Arts and Crafts', nameBn: 'শিল্প ও সংস্কৃতি' },
  PE: {
    code: 'P-09',
    nameEn: 'Physical Education and Health',
    nameBn: 'শারীরিক শিক্ষা ও স্বাস্থ্য',
  },
  AGRI: { code: 'P-10', nameEn: 'Agricultural Education', nameBn: 'কৃষি শিক্ষা' },
  HOME: { code: 'P-11', nameEn: 'Home Science', nameBn: 'গার্হস্থ্য বিজ্ঞান' },
  CAREER: { code: 'P-12', nameEn: 'Career Education', nameBn: 'কর্ম ও জীবনমুখী শিক্ষা' },
} satisfies Record<string, Subject>;

/** Religion and Agri/Home are 'one of' choice groups (D47). */
export const NCTB_RELIGION_GROUP = 'Religion';
export const NCTB_AGRI_HOME_GROUP = 'Agriculture / Home Science';

const RELIGIONS = [S.ISLAM, S.HINDU, S.BUDDHIST, S.CHRISTIAN];

// UNVERIFIED: every list below.
const BY_GRADE: Record<number, Subject[]> = {
  1: [S.BAN, S.ENG, S.MATH, ...RELIGIONS],
  2: [S.BAN, S.ENG, S.MATH, ...RELIGIONS],
  3: [S.BAN, S.ENG, S.MATH, S.BGS, S.SCI, ...RELIGIONS],
  4: [S.BAN, S.ENG, S.MATH, S.BGS, S.SCI, ...RELIGIONS],
  5: [S.BAN, S.ENG, S.MATH, S.BGS, S.SCI, ...RELIGIONS],
  // UNVERIFIED: ICT, Agricultural Education, Home Science, Career Education, Arts, PE for 6-8.
  6: [
    S.BAN,
    S.ENG,
    S.MATH,
    S.SCI,
    S.BGS,
    ...RELIGIONS,
    S.ICT,
    S.ARTS,
    S.PE,
    S.AGRI,
    S.HOME,
    S.CAREER,
  ],
  7: [
    S.BAN,
    S.ENG,
    S.MATH,
    S.SCI,
    S.BGS,
    ...RELIGIONS,
    S.ICT,
    S.ARTS,
    S.PE,
    S.AGRI,
    S.HOME,
    S.CAREER,
  ],
  8: [
    S.BAN,
    S.ENG,
    S.MATH,
    S.SCI,
    S.BGS,
    ...RELIGIONS,
    S.ICT,
    S.ARTS,
    S.PE,
    S.AGRI,
    S.HOME,
    S.CAREER,
  ],
};

const grades = [1, 2, 3, 4, 5, 6, 7, 8];

export const NCTB_PRIMARY: Pick<PresetPack, 'classes' | 'subjects' | 'classSubjects'> = {
  classes: grades.map((g) => ({
    name: `Class ${g}`,
    numericGrade: g,
    stage: g <= 5 ? 'PRIMARY' : 'JUNIOR',
  })),
  subjects: [
    ...new Map(
      Object.values(BY_GRADE)
        .flat()
        .map((s) => [s.code, s]),
    ).values(),
  ],
  // Religion and Agri/Home are 'one of' choice groups (D47).
  classSubjects: grades.flatMap((g) =>
    BY_GRADE[g].map((s) => {
      const row: PresetPack['classSubjects'][number] = { classGrade: g, subjectCode: s.code };
      if (RELIGIONS.includes(s)) row.choiceGroup = NCTB_RELIGION_GROUP;
      else if (g >= 6 && (s === S.AGRI || s === S.HOME)) row.choiceGroup = NCTB_AGRI_HOME_GROUP;
      return row;
    }),
  ),
};

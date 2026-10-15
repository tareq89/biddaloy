/**
 * Demo staffing shape ([58.1.04], D9 / D10): per branch, the subjects with
 * their weekly periods per class and the teacher roster by subject.
 *
 * Week is Saturday to Thursday = 6 teaching days. So a class can have at most
 * `periodsPerDay * 6` periods a week (Primary 36, High 48, College 36).
 */

export type BranchKey = 'PRIMARY' | 'HIGH' | 'COLLEGE';

export interface SubjectDef {
  en: string;
  bn: string;
}

export const SUBJECTS: Readonly<Record<string, SubjectDef>> = {
  BAN: { en: 'Bangla', bn: 'বাংলা' },
  ENG: { en: 'English', bn: 'ইংরেজি' },
  MATH: { en: 'Mathematics', bn: 'গণিত' },
  SCI: { en: 'General Science', bn: 'বিজ্ঞান' },
  BGS: { en: 'Bangladesh and Global Studies', bn: 'বাংলাদেশ ও বিশ্বপরিচয়' },
  REL: { en: 'Religion and Moral Education', bn: 'ধর্ম ও নৈতিক শিক্ষা' },
  ICT: { en: 'ICT', bn: 'তথ্য ও যোগাযোগ প্রযুক্তি' },
  ART: { en: 'Arts and Crafts', bn: 'চারু ও কারুকলা' },
  PE: { en: 'Physical Education', bn: 'শারীরিক শিক্ষা' },
  AGR: { en: 'Agriculture Studies', bn: 'কৃষি শিক্ষা' },
  PHY: { en: 'Physics', bn: 'পদার্থবিজ্ঞান' },
  CHEM: { en: 'Chemistry', bn: 'রসায়ন' },
  BIO: { en: 'Biology', bn: 'জীববিজ্ঞান' },
  ACC: { en: 'Accounting', bn: 'হিসাববিজ্ঞান' },
  BORG: { en: 'Business Organisation and Management', bn: 'ব্যবসায় সংগঠন ও ব্যবস্থাপনা' },
  FIN: { en: 'Finance and Banking', bn: 'ফিন্যান্স ও ব্যাংকিং' },
};

export const PERIODS_PER_DAY: Readonly<Record<BranchKey, number>> = {
  PRIMARY: 6,
  HIGH: 8,
  COLLEGE: 6,
};

/** Teaching days per week: Saturday to Thursday. */
export const TEACHING_DAYS_PER_WEEK = 6;

/** `class name -> subject code -> periods per week`. */
export const WEEKLY_PERIODS: Readonly<
  Record<BranchKey, Readonly<Record<string, Readonly<Record<string, number>>>>>
> = {
  PRIMARY: {
    'Class 1': { BAN: 7, ENG: 6, MATH: 7, BGS: 4, REL: 4, ART: 3, PE: 3 },
    'Class 2': { BAN: 7, ENG: 6, MATH: 7, BGS: 4, REL: 4, ART: 3, PE: 3 },
    'Class 3': { BAN: 6, ENG: 6, MATH: 6, SCI: 4, BGS: 4, REL: 4, ART: 2, PE: 2 },
    'Class 4': { BAN: 6, ENG: 6, MATH: 6, SCI: 4, BGS: 4, REL: 4, ART: 2, PE: 2 },
    'Class 5': { BAN: 6, ENG: 6, MATH: 6, SCI: 4, BGS: 4, REL: 4, ART: 2, PE: 2 },
  },
  HIGH: {
    'Class 6': { BAN: 6, ENG: 6, MATH: 6, SCI: 6, BGS: 5, REL: 4, ICT: 3, PE: 2, ART: 2, AGR: 2 },
    'Class 7': { BAN: 6, ENG: 6, MATH: 6, SCI: 6, BGS: 5, REL: 4, ICT: 3, PE: 2, ART: 2, AGR: 2 },
    'Class 8': { BAN: 6, ENG: 6, MATH: 6, SCI: 6, BGS: 5, REL: 4, ICT: 3, PE: 2, ART: 2, AGR: 2 },
    'Class 9': { BAN: 5, ENG: 5, MATH: 6, PHY: 5, CHEM: 5, BIO: 5, ICT: 4, REL: 4, PE: 2 },
    'Class 10': { BAN: 5, ENG: 5, MATH: 6, PHY: 5, CHEM: 5, BIO: 5, ICT: 4, REL: 4, PE: 2 },
  },
  COLLEGE: {
    'XI Science': { BAN: 4, ENG: 4, ICT: 4, PHY: 6, CHEM: 6, BIO: 6 },
    'XII Science': { BAN: 4, ENG: 4, ICT: 4, PHY: 6, CHEM: 6, BIO: 6 },
    'XI Business Studies': { BAN: 4, ENG: 4, ICT: 4, ACC: 6, BORG: 6, FIN: 6 },
    'XII Business Studies': { BAN: 4, ENG: 4, ICT: 4, ACC: 6, BORG: 6, FIN: 6 },
  },
};

export interface TeacherSlot {
  /** Stable key, e.g. `P-01`. Names are drawn from the name pools by the slice, with `ctx.rng`. */
  slot: string;
  subjects: readonly string[];
  /** Set on a slot that also teaches in another branch (D10: one ICT teacher shared with High). */
  alsoTeachesIn?: BranchKey;
}

const slots = (prefix: string, list: readonly (readonly string[])[]): TeacherSlot[] =>
  list.map((subjects, i) => ({
    slot: `${prefix}-${String(i + 1).padStart(2, '0')}`,
    subjects,
  }));

/** Teachers per branch: Primary 13, High 18, College 8 (own staff; the shared ICT slot lives in High). */
export const TEACHER_ROSTER: Readonly<Record<BranchKey, readonly TeacherSlot[]>> = {
  PRIMARY: slots('P', [
    ['BAN'],
    ['BAN'],
    ['BAN', 'BGS'],
    ['ENG'],
    ['ENG'],
    ['MATH'],
    ['MATH'],
    ['SCI'],
    ['SCI', 'BGS'],
    ['REL'],
    ['REL'],
    ['ART'],
    ['PE'],
  ]),
  HIGH: [
    ...slots('H', [
      ['BAN'],
      ['BAN'],
      ['ENG'],
      ['ENG'],
      ['MATH'],
      ['MATH'],
      ['SCI'],
      ['SCI'],
      ['PHY'],
      ['CHEM'],
      ['BIO'],
      ['BGS'],
      ['REL'],
      ['REL'],
      ['PE'],
      ['ART'],
      ['AGR'],
    ]),
    // The one ICT teacher, shared with College.
    { slot: 'H-18', subjects: ['ICT'], alsoTeachesIn: 'COLLEGE' as BranchKey },
  ],
  COLLEGE: slots('C', [
    ['BAN'],
    ['ENG'],
    ['PHY'],
    ['CHEM'],
    ['BIO'],
    ['ACC'],
    ['BORG', 'FIN'],
    ['ACC', 'FIN'],
  ]),
};

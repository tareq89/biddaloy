import { describe, expect, it } from 'vitest';

import type { PresetPack } from './pack.types';
import { validatePresetPack } from './validate-pack';

const bilingual = { en: 'x', bn: 'x' };

const valid = (): PresetPack => ({
  id: 'bd/nctb',
  schemaVersion: 1,
  version: '2026.1',
  country: 'BD',
  name: bilingual,
  board: bilingual,
  description: bilingual,
  verified: true,
  yearShape: { startMonth: 1 },
  stages: [{ key: 'PRIMARY', name: bilingual }],
  groups: ['SCIENCE'],
  classes: [
    { name: 'One', numericGrade: 1, stage: 'PRIMARY' },
    { name: 'Two', numericGrade: 2, stage: 'PRIMARY' },
  ],
  subjects: [
    { code: 'BAN', nameEn: 'Bangla', nameBn: 'বাংলা' },
    { code: 'ENG', nameEn: 'English', nameBn: 'ইংরেজি' },
  ],
  classSubjects: [{ classGrade: 1, subjectCode: 'BAN' }],
  gradingScale: {
    name: 'GPA',
    bands: [
      { from: 0, to: 32, grade: 'F', gpa: 0, isFail: true },
      { from: 33, to: 79, grade: 'B', gpa: 3, isFail: false },
      { from: 80, to: 100, grade: 'A+', gpa: 5, isFail: false },
    ],
  },
  terms: [
    { name: 'T1', seq: 1, start: { month: 1, day: 1 }, end: { month: 6, day: 30 } },
    { name: 'T2', seq: 2, start: { month: 7, day: 1 }, end: { month: 12, day: 31 } },
  ],
  examTemplates: [
    {
      name: 'Final',
      kind: 'TERM',
      rows: [
        {
          classGrade: 1,
          subjectCode: 'BAN',
          components: [{ name: 'W', kind: 'WRITTEN', full: 100, pass: 33 }],
        },
      ],
    },
  ],
  certificates: ['TESTIMONIAL'],
});

const errorsFor = (mutate: (p: PresetPack) => void): string[] => {
  const p = valid();
  mutate(p);
  return validatePresetPack(p);
};

describe('validatePresetPack', () => {
  it('accepts a minimal valid pack', () => {
    expect(validatePresetPack(valid())).toEqual([]);
  });

  it('accepts an unverified pack with no scale and no templates', () => {
    expect(
      errorsFor((p) => {
        p.verified = false;
        p.gradingScale = null;
        p.examTemplates = [];
      }),
    ).toEqual([]);
  });

  it.each<[string, (p: PresetPack) => void, string]>([
    ['empty id', (p) => (p.id = ' '), 'id must not be empty'],
    ['empty version', (p) => (p.version = ''), 'version must not be empty'],
    ['startMonth 13', (p) => (p.yearShape.startMonth = 13), 'yearShape.startMonth must be 1-12'],
    ['startMonth 0', (p) => (p.yearShape.startMonth = 0), 'yearShape.startMonth must be 1-12'],
    [
      'duplicate stage',
      (p) => p.stages.push({ key: 'PRIMARY', name: bilingual }),
      'duplicate stage key: PRIMARY',
    ],
    [
      'unknown stage',
      (p) => (p.classes[0].stage = 'NOPE'),
      'class One references unknown stage: NOPE',
    ],
    ['duplicate grade', (p) => (p.classes[1].numericGrade = 1), 'duplicate numericGrade: 1'],
    [
      'duplicate subject',
      (p) => p.subjects.push({ code: 'BAN', nameEn: 'a', nameBn: 'a' }),
      'duplicate subject code: BAN',
    ],
    [
      'classSubject unknown class',
      (p) => (p.classSubjects[0].classGrade = 9),
      'classSubject 9/BAN: unknown class grade',
    ],
    [
      'classSubject unknown subject',
      (p) => (p.classSubjects[0].subjectCode = 'ZZZ'),
      'classSubject 1/ZZZ: unknown subject code',
    ],
    [
      'classSubject unknown group',
      (p) => (p.classSubjects[0].group = 'ARTS'),
      'classSubject 1/BAN: unknown group: ARTS',
    ],
    [
      'group and optional',
      (p) => Object.assign(p.classSubjects[0], { group: 'SCIENCE', optional: true }),
      'classSubject 1/BAN: cannot be both group and optional',
    ],
    [
      'band gap',
      (p) => (p.gradingScale!.bands[1].from = 40),
      'grading bands have a gap between F and B',
    ],
    [
      'band overlap',
      (p) => (p.gradingScale!.bands[1].from = 30),
      'grading bands F and B are unsorted or overlap',
    ],
    [
      'bands unsorted',
      (p) => p.gradingScale!.bands.reverse(),
      'grading bands A+ and B are unsorted or overlap',
    ],
    [
      'bands not from 0',
      (p) => (p.gradingScale!.bands[0].from = 5),
      'grading bands must start at 0',
    ],
    [
      'bands not to 100',
      (p) => (p.gradingScale!.bands[2].to = 90),
      'grading bands must end at 100',
    ],
    [
      'fail not lowest',
      (p) => (p.gradingScale!.bands[2].isFail = true),
      'only the lowest grading bands may be isFail',
    ],
    [
      'template unknown class',
      (p) => (p.examTemplates[0].rows[0].classGrade = 9),
      'template Final row 9/BAN: unknown class grade',
    ],
    [
      'template unknown subject',
      (p) => (p.examTemplates[0].rows[0].subjectCode = 'ZZZ'),
      'template Final row 1/ZZZ: unknown subject code',
    ],
    [
      'pass above full',
      (p) => (p.examTemplates[0].rows[0].components[0].pass = 101),
      'template Final row 1/BAN component W: need full >= pass >= 0',
    ],
    [
      'negative pass',
      (p) => (p.examTemplates[0].rows[0].components[0].pass = -1),
      'template Final row 1/BAN component W: need full >= pass >= 0',
    ],
    [
      'zero full',
      (p) => (p.examTemplates[0].rows[0].components[0].full = 0),
      'template Final row 1/BAN component W: full must be > 0',
    ],
    ['duplicate term seq', (p) => (p.terms[1].seq = 1), 'duplicate term seq: 1'],
    [
      'term start after end',
      (p) => (p.terms[0].start = { month: 7, day: 1 }),
      'term T1: start must be before end',
    ],
  ])('flags %s', (_name, mutate, expected) => {
    expect(errorsFor(mutate)).toContain(expected);
  });
});

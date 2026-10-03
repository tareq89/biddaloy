import { validatePresetPack, type PresetPack } from '@biddaloy/shared';
import { describe, expect, it } from 'vitest';

import { makeTestPack } from '../../../__fixtures__/test-pack';
import {
  NCTB_AGRI_HOME_GROUP,
  NCTB_COMMON_SUBJECTS,
  NCTB_PRIMARY,
  NCTB_RELIGION_GROUP,
} from './primary';

describe('NCTB_PRIMARY', () => {
  it('has classes 1-8 with the right stages', () => {
    expect(NCTB_PRIMARY.classes.map((c) => [c.numericGrade, c.stage])).toEqual(
      [1, 2, 3, 4, 5, 6, 7, 8].map((g) => [g, g <= 5 ? 'PRIMARY' : 'JUNIOR']),
    );
  });

  it('has unique subject codes of at most 20 chars and real Bangla names', () => {
    const codes = NCTB_PRIMARY.subjects.map((s) => s.code);
    expect(new Set(codes).size).toBe(codes.length);
    for (const s of NCTB_PRIMARY.subjects) {
      expect(s.code.length).toBeLessThanOrEqual(20);
      expect(s.nameBn).toMatch(/[ঀ-৿]/);
    }
  });

  it('exports the common subjects and includes them', () => {
    const codes = NCTB_PRIMARY.subjects.map((s) => s.code);
    for (const s of Object.values(NCTB_COMMON_SUBJECTS)) expect(codes).toContain(s.code);
  });

  it('has 4 Religion choice-group rows in every class 1-8, never optional', () => {
    for (let g = 1; g <= 8; g++) {
      const rows = NCTB_PRIMARY.classSubjects.filter(
        (c) => c.classGrade === g && c.choiceGroup === NCTB_RELIGION_GROUP,
      );
      expect(rows.map((r) => r.subjectCode)).toEqual(['P-01', 'P-02', 'P-03', 'P-04']);
      expect(rows.every((r) => r.optional === undefined)).toBe(true);
    }
  });

  it('puts exactly P-10 and P-11 in the Agri/Home group at 6-8, none at 1-5', () => {
    for (let g = 1; g <= 8; g++) {
      const rows = NCTB_PRIMARY.classSubjects.filter(
        (c) => c.classGrade === g && c.choiceGroup === NCTB_AGRI_HOME_GROUP,
      );
      expect(rows.map((r) => r.subjectCode)).toEqual(g >= 6 ? ['P-10', 'P-11'] : []);
    }
  });

  it('passes validatePresetPack once merged into a pack', () => {
    const base = makeTestPack();
    const pack: PresetPack = {
      ...base,
      ...NCTB_PRIMARY,
      stages: [
        { key: 'PRIMARY', name: { en: 'Primary', bn: 'প্রাথমিক' } },
        { key: 'JUNIOR', name: { en: 'Junior', bn: 'নিম্ন মাধ্যমিক' } },
      ],
      groups: [],
      examTemplates: [],
    };
    expect(validatePresetPack(pack)).toEqual([]);
  });
});

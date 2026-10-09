import { validatePresetPack } from '@biddaloy/shared';
import { describe, expect, it } from 'vitest';

import { keyOf, selectedClasses, type ApplyContext } from '../../../apply/apply-context';
import { NCTB_PACK } from './index';

describe('NCTB_PACK', () => {
  it('validates', () => {
    expect(validatePresetPack(NCTB_PACK)).toEqual([]);
  });

  it('has 12 classes across the four stages', () => {
    expect(NCTB_PACK.classes).toHaveLength(12);
    expect(NCTB_PACK.stages.map((s) => s.key)).toEqual([
      'PRIMARY',
      'JUNIOR',
      'SECONDARY',
      'HIGHER_SECONDARY',
    ]);
  });

  it('scale covers 0-100 with F as the only fail', () => {
    const bands = NCTB_PACK.gradingScale!.bands;
    expect(bands[0].from).toBe(0);
    expect(bands[bands.length - 1].to).toBe(100);
    expect(bands.filter((b) => b.isFail).map((b) => b.grade)).toEqual(['F']);
  });

  it('puts every Science group-only subject in groups', () => {
    const science = NCTB_PACK.classSubjects.filter((c) => c.group === 'Science');
    expect(science.length).toBeGreaterThan(0);
    expect(NCTB_PACK.groups).toContain('Science');
    expect(NCTB_PACK.groups).toEqual(['Science', 'Humanities', 'Business Studies']);
  });

  it('class-9 Physics template row components sum to its full marks', () => {
    const physics = NCTB_PACK.subjects.find((s) => s.nameEn === 'Physics')!;
    for (const t of NCTB_PACK.examTemplates) {
      const row = t.rows.find((r) => r.classGrade === 9 && r.subjectCode === physics.code)!;
      expect(row.components.reduce((n, c) => n + c.full, 0)).toBe(100);
    }
    expect(NCTB_PACK.examTemplates.map((t) => t.name)).toEqual(['Annual exam', 'Half-yearly exam']);
  });

  it('creates a class per selected stage x version for the apply writers', () => {
    const ctx = {
      pack: NCTB_PACK,
      options: {
        presetId: 'bd/nctb',
        startYear: 2027,
        stages: ['SECONDARY', 'HIGHER_SECONDARY'],
        versions: ['bangla'],
      },
    } as unknown as ApplyContext;
    const keys = selectedClasses(ctx).map((c) => keyOf(c.numericGrade, c.version));
    expect(keys).toEqual(['9:bangla', '10:bangla', '11:bangla', '12:bangla']);
    const versionKeys = NCTB_PACK.versions!.map((v) => v.key);
    expect(versionKeys).toContain('bangla');
  });

  it('has at most one classSubject row per class+subject', () => {
    const keys = NCTB_PACK.classSubjects.map((c) => `${c.classGrade}:${c.subjectCode}`);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('has 4 Religion members at classes 1-10 and none at 11-12', () => {
    for (let g = 1; g <= 12; g++) {
      const n = NCTB_PACK.classSubjects.filter(
        (c) => c.classGrade === g && c.choiceGroup === 'Religion',
      ).length;
      expect(n).toBe(g <= 10 ? 4 : 0);
    }
  });
});

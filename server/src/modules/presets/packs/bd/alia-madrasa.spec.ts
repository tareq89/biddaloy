import { validatePresetPack } from '@biddaloy/shared';
import { ALIA_PACK } from './alia-madrasa';

describe('ALIA_PACK', () => {
  it('validates', () => {
    expect(validatePresetPack(ALIA_PACK)).toEqual([]);
  });

  it('has the five stages in order', () => {
    expect(ALIA_PACK.stages.map((s) => s.key)).toEqual([
      'EBTEDAYEE',
      'DAKHIL',
      'ALIM',
      'FAZIL',
      'KAMIL',
    ]);
  });

  it('has Fazil/Kamil year classes as grades 13-16', () => {
    const named = (g: number) => ALIA_PACK.classes.find((c) => c.numericGrade === g);
    expect([13, 14, 15, 16].map((g) => named(g)?.name)).toEqual([
      'Fazil 1st Year',
      'Fazil 2nd Year',
      'Kamil 1st Year',
      'Kamil 2nd Year',
    ]);
    expect(named(16)?.stage).toBe('KAMIL');
  });

  it('never lists a group-only subject without its group', () => {
    const groupOnly = new Set(
      ALIA_PACK.classSubjects.filter((cs) => cs.group).map((cs) => cs.subjectCode),
    );
    const leaked = ALIA_PACK.classSubjects.filter(
      (cs) => !cs.group && groupOnly.has(cs.subjectCode),
    );
    expect(leaked).toEqual([]);
  });

  it('is marked unverified while subject allocation is unconfirmed', () => {
    expect(ALIA_PACK.verified).toBe(false);
  });
});

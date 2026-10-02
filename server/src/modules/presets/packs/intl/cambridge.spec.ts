import { validatePresetPack } from '@biddaloy/shared';
import { describe, expect, it } from 'vitest';

import { CAMBRIDGE_PACK } from './cambridge';

describe('CAMBRIDGE_PACK', () => {
  it('passes validatePresetPack', () => {
    expect(validatePresetPack(CAMBRIDGE_PACK)).toEqual([]);
  });

  it('is an unverified INTL pack', () => {
    expect(CAMBRIDGE_PACK.country).toBe('INTL');
    expect(CAMBRIDGE_PACK.verified).toBe(false);
  });

  it('has no GPA on any band and only U fails', () => {
    const bands = CAMBRIDGE_PACK.gradingScale!.bands;
    expect(bands.every((b) => b.gpa === null)).toBe(true);
    expect(bands.filter((b) => b.isFail).map((b) => b.grade)).toEqual(['U']);
  });

  it('has four stages and Year 13', () => {
    expect(CAMBRIDGE_PACK.stages).toHaveLength(4);
    expect(CAMBRIDGE_PACK.classes.find((c) => c.numericGrade === 13)?.name).toBe('Year 13');
  });
});

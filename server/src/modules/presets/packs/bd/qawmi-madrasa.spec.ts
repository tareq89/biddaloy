import { validatePresetPack } from '@biddaloy/shared';
import { describe, expect, it } from 'vitest';

import { QAWMI_PACK } from './qawmi-madrasa';

describe('QAWMI_PACK', () => {
  it('validates with a null grading scale', () => {
    expect(QAWMI_PACK.gradingScale).toBeNull();
    expect(validatePresetPack(QAWMI_PACK)).toEqual([]);
  });

  it('is unverified with no templates or terms', () => {
    expect(QAWMI_PACK.verified).toBe(false);
    expect(QAWMI_PACK.examTemplates).toEqual([]);
    expect(QAWMI_PACK.terms).toEqual([]);
  });

  it('has no Tahfeez stage, class or subject', () => {
    const all = JSON.stringify([QAWMI_PACK.stages, QAWMI_PACK.classes, QAWMI_PACK.subjects]);
    expect(all.toLowerCase()).not.toContain('tahfeez');
  });

  it('says marks and grading scale are set by the school', () => {
    expect(QAWMI_PACK.description.en).toContain('set by the school');
  });
});

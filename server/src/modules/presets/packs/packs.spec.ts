import { describe, it, expect } from 'vitest';
import { validatePresetPack } from '@biddaloy/shared';
import { PRESET_PACKS } from './index';

describe('PRESET_PACKS', () => {
  it('registers five packs with unique ids', () => {
    expect(PRESET_PACKS).toHaveLength(5);
    expect(new Set(PRESET_PACKS.map((p) => p.id)).size).toBe(5);
  });

  it.each(PRESET_PACKS.map((p) => [p.id, p] as const))('%s is valid and bilingual', (_id, p) => {
    expect(validatePresetPack(p)).toEqual([]);
    for (const text of [p.name, p.description]) {
      expect(text.en.trim()).not.toBe('');
      expect(text.bn.trim()).not.toBe('');
    }
    if (!p.verified) expect(p.description.en.trim().length).toBeGreaterThan(0);
  });
});

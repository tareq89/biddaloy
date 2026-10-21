import { describe, expect, it } from 'vitest';
import { SEGMENTS, SEGMENT_IDS, type Text } from './segments';

// Copied from server/src/modules/presets/packs/index.ts — update when a pack is added.
const PACK_IDS = ['bd/nctb', 'bd/alia-madrasa', 'bd/qawmi-madrasa', 'intl/cambridge', 'blank'];

const full = (t: Text, label: string) => {
  expect(t.bn.trim(), `${label}.bn`).not.toBe('');
  expect(t.en.trim(), `${label}.en`).not.toBe('');
};

describe('segments', () => {
  it('has the three segment ids', () => {
    expect(SEGMENT_IDS).toEqual(['school', 'madrasa', 'english-medium']);
    expect(Object.keys(SEGMENTS).sort()).toEqual([...SEGMENT_IDS].sort());
  });

  it('presets exist in the packs index', () => {
    for (const id of SEGMENT_IDS) for (const p of SEGMENTS[id].presets) expect(PACK_IDS, `${id}:${p}`).toContain(p);
  });

  it('each segment is complete in both languages', () => {
    for (const id of SEGMENT_IDS) {
      const s = SEGMENTS[id];
      expect(s.features, `${id}.features`).toHaveLength(5);
      expect(s.shots, `${id}.shots`).toHaveLength(2);
      expect(s.faq, `${id}.faq`).toHaveLength(3);
      for (const k of ['title', 'description', 'h1', 'sub'] as const) full(s[k], `${id}.${k}`);
      expect(s.description.bn.length, `${id}.description.bn`).toBeLessThanOrEqual(155);
      expect(s.description.en.length, `${id}.description.en`).toBeLessThanOrEqual(155);
      s.features.forEach((f, i) => { full(f.title, `${id}.features[${i}].title`); full(f.body, `${id}.features[${i}].body`); });
      s.faq.forEach((f, i) => { full(f.q, `${id}.faq[${i}].q`); full(f.a, `${id}.faq[${i}].a`); });
    }
  });
});

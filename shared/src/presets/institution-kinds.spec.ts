import { describe, expect, it } from 'vitest';
import { CORE_AREAS, LABEL_SUGGESTIONS, ModuleKey } from '../enums/module-key';
import { EntityLabel } from '../enums/entity-label';
import { INSTITUTION_KINDS } from './institution-kinds';

// Ids registered in server/src/modules/presets/packs/index.ts (blank is not a kind).
const PACK_IDS = ['bd/nctb', 'bd/alia-madrasa', 'bd/qawmi-madrasa', 'intl/cambridge', 'blank'];
const labelKeys: string[] = Object.values(EntityLabel).filter(
  (k) => !['shift', 'version', 'group'].includes(k),
);

describe('INSTITUTION_KINDS', () => {
  it('has 8 unique ids', () => {
    const ids = INSTITUTION_KINDS.map((k) => k.id);
    expect(ids).toHaveLength(8);
    expect(new Set(ids).size).toBe(8);
  });

  it('never switches a core area and only uses real module keys', () => {
    for (const k of INSTITUTION_KINDS) {
      for (const m of Object.keys(k.modules)) {
        expect(Object.keys(ModuleKey)).toContain(m);
        expect(CORE_AREAS as readonly string[]).not.toContain(m);
      }
    }
  });

  it('label keys are entity labels minus shift/version/group', () => {
    for (const k of INSTITUTION_KINDS) {
      for (const l of Object.keys(k.labels)) expect(labelKeys).toContain(l);
    }
    for (const l of Object.keys(LABEL_SUGGESTIONS)) expect(labelKeys).toContain(l);
  });

  it('matchesPresetIds exist in the server pack list, once each', () => {
    const all = INSTITUTION_KINDS.flatMap((k) => k.matchesPresetIds);
    for (const id of all) expect(PACK_IDS).toContain(id);
    expect(new Set(all).size).toBe(all.length);
  });

  it('coaching renames class and section, keeps guardian stock', () => {
    const c = INSTITUTION_KINDS.find((k) => k.id === 'coaching')!;
    expect(c.labels.class?.bn).toBe('কোর্স');
    expect(c.labels.section?.bn).toBe('ব্যাচ');
    expect(c.labels.guardian).toBeUndefined();
  });
});

import { describe, expect, it } from 'vitest';
import { keyOf, selectedClasses, type ApplyContext } from './apply-context';
import { makeTestPack } from '../__fixtures__/test-pack';

const ctx = (stages: string[], versions: string[], withVersions = false): ApplyContext => {
  const pack = makeTestPack();
  if (withVersions)
    pack.versions = [
      { key: 'BN', name: { en: 'Bangla', bn: 'বাংলা' } },
      { key: 'EN', name: { en: 'English', bn: 'ইংরেজি' } },
    ];
  return {
    pack,
    options: { presetId: pack.id, startYear: 2026, stages, versions },
  } as ApplyContext;
};

describe('selectedClasses', () => {
  it('filters by stage, version null when pack has no versions', () => {
    const r = selectedClasses(ctx(['PRIMARY'], []));
    expect(r.map((c) => keyOf(c.numericGrade, c.version))).toEqual(['1:', '2:']);
  });

  it('one entry per class x selected version', () => {
    const r = selectedClasses(ctx(['SECONDARY'], ['BN', 'EN'], true));
    expect(r.map((c) => keyOf(c.numericGrade, c.version))).toEqual(['9:BN', '9:EN']);
  });
});

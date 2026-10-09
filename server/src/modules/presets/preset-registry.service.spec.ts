import { describe, expect, it } from 'vitest';
import { NotFoundException } from '@nestjs/common';
import { PresetRegistryService } from './preset-registry.service';
import { makeTestPack } from './__fixtures__/test-pack';

const registryWith = (...packs: ReturnType<typeof makeTestPack>[]) => {
  const r = new PresetRegistryService();
  r.packs = packs;
  return r;
};

describe('PresetRegistryService', () => {
  it('lists summaries without the heavy fields', () => {
    const [s] = registryWith(makeTestPack()).list();
    expect(s).toMatchObject({ id: 'test/pack', version: '1.0', country: 'BD', verified: true });
    expect(s).not.toHaveProperty('classes');
    expect(s.stages).toHaveLength(2);
  });

  it('gets a pack by id and 404s on unknown', () => {
    const r = registryWith(makeTestPack());
    expect(r.get('test/pack').id).toBe('test/pack');
    expect(() => r.get('nope')).toThrow(NotFoundException);
  });

  it('validateAll passes for a valid pack and throws (boot fails) on a bad band', () => {
    expect(() => registryWith(makeTestPack()).onModuleInit()).not.toThrow();
    const bad = makeTestPack();
    bad.gradingScale!.bands[1].from = 40;
    expect(() => registryWith(bad).onModuleInit()).toThrow(/test\/pack: .*gap/);
  });
});

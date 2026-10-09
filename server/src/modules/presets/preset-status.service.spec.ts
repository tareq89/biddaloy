import { describe, expect, it, vi } from 'vitest';
import { PresetStatusService } from './preset-status.service';
import { FRESH_TENANT_ENTITIES } from './preset-blockers';
import { Class } from '../academics/entities/class.entity';

const make = (preset: unknown, counts: Map<unknown, number> = new Map()) => {
  const settings = { preset: vi.fn().mockResolvedValue(preset) };
  const dataSource = {
    manager: {
      getRepository: (e: unknown) => ({ count: async () => counts.get(e) ?? 0 }),
    },
  };
  return new PresetStatusService(settings as never, dataSource as never);
};

describe('PresetStatusService', () => {
  it('AVAILABLE when no preset and every fresh entity is empty', async () => {
    expect(await make(undefined).status('t1')).toEqual({ state: 'AVAILABLE' });
  });

  it('CUSTOM with blockers when a class exists', async () => {
    const s = await make(undefined, new Map([[Class, 1]])).status('t1');
    expect(s).toEqual({ state: 'CUSTOM', blockers: [{ entity: 'classes', count: 1 }] });
  });

  it('APPLIED when the preset block is set, without counting', async () => {
    const preset = { id: 'bd/nctb', version: '1', appliedAt: 'x' };
    expect(await make(preset).status('t1')).toEqual({ state: 'APPLIED', preset });
  });

  it('covers every D33 entity', () => {
    expect(FRESH_TENANT_ENTITIES.map((e) => e.label)).toHaveLength(7);
  });
});

import { describe, expect, it, vi } from 'vitest';
import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { PresetApplyService } from './preset-apply.service';
import { PresetRegistryService } from './preset-registry.service';
import { makeTestPack } from './__fixtures__/test-pack';
import { buildErrorResponseBody } from '../../common/filters/error-response';
import { Class } from '../academics/entities/class.entity';

function make(opts: { storedPreset?: unknown; counts?: Map<unknown, number> } = {}) {
  const registry = new PresetRegistryService();
  registry.packs = [makeTestPack()];
  const audit = { record: vi.fn().mockResolvedValue(undefined) };
  const cache = { invalidate: vi.fn() };
  const school = { id: 't1', settings: opts.storedPreset ? { preset: opts.storedPreset } : {} };
  const manager = {
    getRepository: (e: unknown) =>
      e === Class || opts.counts?.has(e)
        ? { count: async () => opts.counts?.get(e) ?? 0 }
        : {
            createQueryBuilder: () => ({
              where: () => ({ setLock: () => ({ getOne: async () => school }) }),
            }),
            count: async () => 0,
          },
  };
  const ds = { transaction: async (fn: (m: unknown) => unknown) => fn(manager) };
  const svc = new PresetApplyService(ds as never, registry, audit as never, cache as never);
  return { svc, audit, cache };
}

const dto = (over = {}) => ({
  preset_id: 'test/pack',
  start_year: 2026,
  stages: ['PRIMARY'],
  ...over,
});

describe('PresetApplyService validation', () => {
  it('unknown preset 404', async () => {
    await expect(make().svc.apply('t1', 'u1', dto({ preset_id: 'nope' }))).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
  it('bad stage 400', async () => {
    await expect(make().svc.apply('t1', 'u1', dto({ stages: ['X'] }))).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });
  it('versions on a pack without versions 400', async () => {
    await expect(make().svc.apply('t1', 'u1', dto({ versions: ['BN'] }))).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });
});

describe('PresetApplyService guard', () => {
  it('existing class -> PRESET_NOT_FRESH with blockers, nothing written', async () => {
    const { svc, audit, cache } = make({ counts: new Map([[Class, 2]]) });
    const err = await svc.apply('t1', 'u1', dto()).catch((e) => e);
    expect(err).toBeInstanceOf(ConflictException);
    expect(err.getResponse()).toMatchObject({
      details: { code: 'PRESET_NOT_FRESH', blockers: [{ entity: 'classes', count: 2 }] },
    });
    expect(audit.record).not.toHaveBeenCalled();
    expect(cache.invalidate).not.toHaveBeenCalled();
  });

  it('final production body keeps details.code and blockers', async () => {
    const { svc } = make({ counts: new Map([[Class, 2]]) });
    const err = await svc.apply('t1', 'u1', dto()).catch((e) => e);
    expect(
      buildErrorResponseBody(err, { path: '/x', requestId: 'r', nodeEnv: 'production' }).details,
    ).toEqual({
      code: 'PRESET_NOT_FRESH',
      blockers: [{ entity: 'classes', count: 2 }],
    });
  });

  it('stored preset on the locked row -> PRESET_NOT_FRESH', async () => {
    const { svc } = make({ storedPreset: { id: 'test/pack' } });
    await expect(svc.apply('t1', 'u1', dto())).rejects.toBeInstanceOf(ConflictException);
  });
});

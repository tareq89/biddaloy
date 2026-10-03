import { describe, expect, it, vi } from 'vitest';
import { ConflictException, NotFoundException } from '@nestjs/common';
import { validate } from 'class-validator';
import { PresetResetService } from './preset-reset.service';
import { RESET_BLOCKER_ENTITIES } from './preset-blockers';
import { buildErrorResponseBody } from '../../common/filters/error-response';
import { ResetPresetDto } from './dto/reset-preset.dto';

function make(opts: { school?: object | null; blocked?: unknown } = {}) {
  const audit = { record: vi.fn().mockResolvedValue(undefined) };
  const cache = { invalidate: vi.fn() };
  const del = vi.fn().mockResolvedValue({ affected: 1 });
  const school =
    opts.school === undefined
      ? { id: 't1', settings: { preset: { id: 'p', version: '1' } } }
      : opts.school;
  const manager = {
    getRepository: (e: unknown) => ({
      createQueryBuilder: () => ({
        where: () => ({ setLock: () => ({ getOne: async () => school }) }),
      }),
      count: async () => (e === opts.blocked ? 2 : 0),
      softDelete: del,
      delete: del,
      update: vi.fn(),
    }),
  };
  const ds = { transaction: async (fn: (m: unknown) => unknown) => fn(manager) };
  const svc = new PresetResetService(ds as never, audit as never, cache as never);
  return { svc, audit, cache, del };
}
const dto = { reason: 'wrong curriculum chosen' };

describe('PresetResetService', () => {
  it('unknown school -> 404', async () => {
    await expect(make({ school: null }).svc.reset('t1', 'u', dto)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('no preset applied -> 409 PRESET_NOT_APPLIED, nothing deleted', async () => {
    const m = make({ school: { id: 't1', settings: {} } });
    const err = await m.svc.reset('t1', 'u', dto).catch((e) => e);
    expect(err).toBeInstanceOf(ConflictException);
    expect(err.getResponse()).toMatchObject({ details: { code: 'PRESET_NOT_APPLIED' } });
    expect(m.del).not.toHaveBeenCalled();
  });

  it('final production body keeps details.code (+ blockers); stage a blocker', async () => {
    const na = await make({ school: { id: 't1', settings: {} } })
      .svc.reset('t1', 'u', dto)
      .catch((e) => e);
    const naBody = buildErrorResponseBody(na, {
      path: '/x',
      requestId: 'r',
      nodeEnv: 'production',
    });
    expect(naBody.details).toEqual({ code: 'PRESET_NOT_APPLIED' });
    expect(naBody.message).toEqual(expect.any(String));

    const [{ label, entity }] = RESET_BLOCKER_ENTITIES;
    const bl = await make({ blocked: entity })
      .svc.reset('t1', 'u', dto)
      .catch((e) => e);
    expect(
      buildErrorResponseBody(bl, { path: '/x', requestId: 'r', nodeEnv: 'production' }).details,
    ).toEqual({
      code: 'PRESET_RESET_BLOCKED',
      blockers: [{ entity: label, count: 2 }],
    });
  });

  it.each(RESET_BLOCKER_ENTITIES.map((b) => [b.label, b.entity] as const))(
    '%s present -> 409 PRESET_RESET_BLOCKED with that label',
    async (label, entity) => {
      const m = make({ blocked: entity });
      const err = await m.svc.reset('t1', 'u', dto).catch((e) => e);
      expect(err.getResponse()).toMatchObject({
        details: { code: 'PRESET_RESET_BLOCKED', blockers: [{ entity: label, count: 2 }] },
      });
      expect(m.del).not.toHaveBeenCalled();
      expect(m.audit.record).not.toHaveBeenCalled();
      expect(m.cache.invalidate).not.toHaveBeenCalled();
    },
  );

  it('success audits and evicts cache', async () => {
    const m = make();
    await m.svc.reset('t1', 'u', dto);
    expect(m.audit.record).toHaveBeenCalledTimes(1);
    expect(m.cache.invalidate).toHaveBeenCalledWith('t1');
  });

  it('reason shorter than 10 chars is rejected by the DTO (400 via ValidationPipe)', async () => {
    const d = Object.assign(new ResetPresetDto(), { reason: 'too short' });
    expect(await validate(d)).toHaveLength(1);
    expect(await validate(Object.assign(new ResetPresetDto(), dto))).toHaveLength(0);
  });
});

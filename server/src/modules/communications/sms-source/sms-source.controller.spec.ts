import 'reflect-metadata';
import { describe, it, expect, vi } from 'vitest';
import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { Permission } from '@biddaloy/shared';
import { PERMISSIONS_KEY } from '../../auth/decorators/require-permissions.decorator';
import { SetSmsSourceDto, SmsSourceController } from './sms-source.controller';

// The HTTP-level X-Tenant-ID / role checks need the controller wired into a module (ticket #3866
// adds it, with the e2e). Here: the guard metadata that those checks rely on, plus DTO and tenant use.
describe('SmsSourceController', () => {
  it('is guarded by the standard chain and needs SETTINGS_MANAGE (ADMIN only)', () => {
    const guards = Reflect.getMetadata('__guards__', SmsSourceController) as unknown[];
    expect(guards).toHaveLength(4);
    expect(Reflect.getMetadata(PERMISSIONS_KEY, SmsSourceController)).toEqual([
      Permission.SETTINGS_MANAGE,
    ]);
  });

  it('PUT is throttled', () => {
    const keys = Reflect.getMetadataKeys(SmsSourceController.prototype.set);
    expect(keys.some((k) => String(k).startsWith('THROTTLER:LIMIT'))).toBe(true);
  });

  it('DTO accepts only the two sources', async () => {
    for (const source of ['OWN', 'SCHOOLMANAGERP']) {
      expect(await validate(plainToInstance(SetSmsSourceDto, { source }))).toHaveLength(0);
    }
    for (const bad of [{ source: 'x' }, {}, { source: 1 }]) {
      expect(await validate(plainToInstance(SetSmsSourceDto, bad))).not.toHaveLength(0);
    }
  });

  it('writes only the caller tenant row (tenant comes from the token context, not the body)', async () => {
    const service = { set: vi.fn(async () => ({})), get: vi.fn() };
    const c = new SmsSourceController(service as any);
    await c.set({ id: 'tenant-A' }, { sub: 'u1' } as any, { source: 'OWN' }, {
      ip: '1.1.1.1',
      headers: {},
    } as any);
    expect(service.set).toHaveBeenCalledWith('tenant-A', 'OWN', 'u1', expect.anything());
  });
});

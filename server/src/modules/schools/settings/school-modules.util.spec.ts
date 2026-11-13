import { describe, it, expect, vi } from 'vitest';
import { UserRole } from '@biddaloy/shared';
import { isModuleOnForSchool } from './school-modules.util';

const reader = (state: unknown) => ({ forTenant: vi.fn(async () => state) }) as any;

describe('isModuleOnForSchool', () => {
  it('is on when there is no modules block (default on)', async () => {
    expect(await isModuleOnForSchool(reader({ platform: {}, school: {} }), 't', 'fees')).toBe(true);
  });

  it('is off when the school turned the module off', async () => {
    const r = reader({ platform: {}, school: { fees: { on: false } } });
    expect(await isModuleOnForSchool(r, 't', 'fees')).toBe(false);
    expect(r.forTenant).toHaveBeenCalledWith('t');
  });

  it('is off when the platform turned it off, even if the school says on', async () => {
    const r = reader({ platform: { fees: false }, school: { fees: { on: true } } });
    expect(await isModuleOnForSchool(r, 't', 'fees')).toBe(false);
  });

  it('is off when the module it depends on is off (fines depend on fees)', async () => {
    const r = reader({ platform: {}, school: { fees: { on: false } } });
    expect(await isModuleOnForSchool(r, 't', 'fines')).toBe(false);
  });

  it('ignores role-off: a school job never stops because roles lost the module', async () => {
    const r = reader({
      platform: {},
      school: { fees: { on: true, offForRoles: [UserRole.ACCOUNTANT, UserRole.TEACHER] } },
    });
    expect(await isModuleOnForSchool(r, 't', 'fees')).toBe(true);
  });

  it('propagates a read failure so the caller can fail closed', async () => {
    const r = { forTenant: vi.fn().mockRejectedValue(new Error('db down')) } as any;
    await expect(isModuleOnForSchool(r, 't', 'fees')).rejects.toThrow('db down');
  });
});

import { describe, expect, it, vi } from 'vitest';
import { Reflector } from '@nestjs/core';
import { Permission, UserRole, roleHasPermission } from '@biddaloy/shared';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import { PresetsController } from './presets.controller';
import { PresetRegistryService } from './preset-registry.service';
import { makeTestPack } from './__fixtures__/test-pack';

const registry = new PresetRegistryService();
registry.packs = [makeTestPack()];
const status = { status: vi.fn().mockResolvedValue({ state: 'AVAILABLE' }) };
const controller = new PresetsController(registry, status as never);

describe('PresetsController', () => {
  it('lists, reports status, and previews (never the raw pack)', async () => {
    expect(controller.list()).toHaveLength(1);
    expect(await controller.getStatus({ id: 't1' })).toEqual({ state: 'AVAILABLE' });
    expect(status.status).toHaveBeenCalledWith('t1');
    const p = controller.preview('test/pack');
    expect(p.summary.id).toBe('test/pack');
    expect(p.examTemplates).toEqual([{ name: 'Final', rowCount: 1 }]);
    expect(p.counts).toEqual({
      stages: 2,
      classes: 3,
      subjects: 4,
      classSubjects: 4,
      terms: 1,
      examTemplates: 1,
    });
    expect(p).not.toHaveProperty('classSubjects');
    expect(p.versions).toEqual([]);
  });

  it('rejects an unknown id with 404', () => {
    expect(() => controller.preview('nope')).toThrow(/not found/i);
  });

  it('ADMIN allowed, TEACHER rejected with 403 (permission guard)', () => {
    const guard = new PermissionsGuard(new Reflector());
    const ctx = (role: string) =>
      ({
        getHandler: () => PresetsController.prototype.list,
        getClass: () => PresetsController,
        switchToHttp: () => ({ getRequest: () => ({ currentTenant: { role } }) }),
      }) as never;
    expect(guard.canActivate(ctx(UserRole.ADMIN))).toBe(true);
    expect(() => guard.canActivate(ctx(UserRole.TEACHER))).toThrow(/Requires permission/);
    expect(roleHasPermission(UserRole.ADMIN, Permission.CURRICULUM_PRESET_APPLY)).toBe(true);
    expect(roleHasPermission(UserRole.TEACHER, Permission.CURRICULUM_PRESET_APPLY)).toBe(false);
  });
});

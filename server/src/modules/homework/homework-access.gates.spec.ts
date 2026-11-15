import { describe, it, expect, vi } from 'vitest';
import { Permission, UserRole } from '@biddaloy/shared';
import { HomeworkAccessService } from './homework-access.service';

// Only this permission is held: the manage gate (HOMEWORK_ASSIGN) and the view gate
// (HOMEWORK_READ) must each read their own, so swapping them breaks one of these (#1385).
let held: Permission[] = [];
vi.mock('@biddaloy/shared', async (orig) => ({
  ...(await orig<typeof import('@biddaloy/shared')>()),
  roleHasPermission: (_role: string, p: Permission) => held.includes(p),
}));
vi.mock('../classes/teacher-scope.service', () => ({
  teacherAssignments: vi.fn(async () => []),
  teacherSectionIds: vi.fn(async () => []),
  teacherCoordinatedClassIds: vi.fn(async () => []),
}));

const service = () =>
  new HomeworkAccessService(
    { manager: {} } as never,
    { findOne: vi.fn(async () => ({ id: 's', tenant_id: 't' })), exist: vi.fn() } as never,
    {} as never,
    {} as never,
    {} as never,
  );

describe('homework tenant-wide gates read different permissions', () => {
  it('HOMEWORK_READ alone views but does not manage', async () => {
    held = [Permission.HOMEWORK_READ];
    const s = service();
    expect(s.canManageTenantWide(UserRole.ADMIN)).toBe(false);
    await expect(s.assertCanViewSection(UserRole.ADMIN, 'u', 's', 't')).resolves.toBeUndefined();
    await expect(s.assertCanManageSection(UserRole.ADMIN, 'u', 's', 'sub', 't')).rejects.toThrow();
  });

  it('HOMEWORK_ASSIGN alone manages but does not view', async () => {
    held = [Permission.HOMEWORK_ASSIGN];
    const s = service();
    expect(s.canManageTenantWide(UserRole.ADMIN)).toBe(true);
    await expect(s.assertCanViewSection(UserRole.ADMIN, 'u', 's', 't')).rejects.toThrow();
  });
});

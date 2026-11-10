import { describe, it, expect, vi } from 'vitest';
import { UserStatus } from '@biddaloy/shared';
import { PlatformAdminService } from './platform-admin.service';

describe('PlatformAdminService', () => {
  it('isPlatformAdmin asks the owners table by user id', async () => {
    const exists = vi.fn().mockResolvedValue(true);
    const svc = new PlatformAdminService({ exists } as never);
    expect(await svc.isPlatformAdmin('u1')).toBe(true);
    expect(exists).toHaveBeenCalledWith({ where: { user_id: 'u1' } });
  });

  it('listOwners flattens the joined user and the lock columns', async () => {
    const at = new Date('2030-01-01T00:00:00Z');
    const find = vi.fn().mockResolvedValue([
      {
        user_id: 'u1',
        locked_by: 'u2',
        locked_at: at,
        user: { status: UserStatus.SUSPENDED, email: 'a@x.test', phone: '+8801700000000' },
      },
    ]);
    const svc = new PlatformAdminService({ find } as never);
    expect(await svc.listOwners()).toEqual([
      {
        user_id: 'u1',
        status: UserStatus.SUSPENDED,
        email: 'a@x.test',
        phone: '+8801700000000',
        locked_by: 'u2',
        locked_at: at,
      },
    ]);
  });

  it('countActive counts only ACTIVE users', async () => {
    const count = vi.fn().mockResolvedValue(1);
    const svc = new PlatformAdminService({ count } as never);
    expect(await svc.countActive()).toBe(1);
    expect(count).toHaveBeenCalledWith({ where: { user: { status: UserStatus.ACTIVE } } });
  });
});

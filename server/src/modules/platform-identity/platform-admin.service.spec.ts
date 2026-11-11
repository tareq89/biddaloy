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

  it('activeOwnerIds share-locks every owner row before reading ACTIVE owners', async () => {
    const query = vi
      .fn()
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ user_id: 'u1' }]);
    const em = { query };
    const transaction = vi.fn(async (work: (m: unknown) => unknown) => work(em));
    const svc = new PlatformAdminService({ manager: { transaction } } as never);
    expect(await svc.activeOwnerIds()).toEqual(['u1']);
    expect(transaction).toHaveBeenCalledTimes(1);
    expect(query.mock.calls[0][0]).toMatch(/FROM platform_admins ORDER BY user_id FOR SHARE/);
    expect(query.mock.calls[1][1]).toEqual([UserStatus.ACTIVE]);
    // With a caller's transaction it uses that one.
    query.mockResolvedValueOnce([]).mockResolvedValueOnce([]);
    expect(await svc.activeOwnerIds(em as never)).toEqual([]);
    expect(transaction).toHaveBeenCalledTimes(1);
  });
});

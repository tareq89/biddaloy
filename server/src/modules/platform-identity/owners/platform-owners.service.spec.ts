import { describe, it, expect, vi } from 'vitest';
import { PlatformOwnersService } from './platform-owners.service';

function build(query = vi.fn()) {
  const ds: any = { query, transaction: vi.fn() };
  const svc = new PlatformOwnersService(ds, {} as any, {} as any, {} as any, {} as any, {} as any);
  return { svc, ds };
}

describe('PlatformOwnersService', () => {
  it('refuses to lock or unlock yourself before touching the database', async () => {
    const { svc, ds } = build();
    await expect(svc.lock('u1', 'u1')).rejects.toMatchObject({
      status: 409,
      response: { details: { code: 'CANNOT_LOCK_SELF' } },
    });
    await expect(svc.unlock('u1', 'u1')).rejects.toMatchObject({ status: 409 });
    expect(ds.transaction).not.toHaveBeenCalled();
    expect(ds.query).not.toHaveBeenCalled();
  });

  it('an actor locked while waiting on the owner lock cannot lock or unlock anyone', async () => {
    const em = { query: vi.fn() };
    const { svc, ds } = build();
    ds.transaction.mockImplementation(async (work: (m: unknown) => unknown) => work(em));
    // Three owners: b was locked by a while b's own request waited; c is still active.
    em.query.mockResolvedValueOnce([]).mockResolvedValueOnce([
      { user_id: 'a', status: 'ACTIVE' },
      { user_id: 'b', status: 'SUSPENDED' },
      { user_id: 'c', status: 'ACTIVE' },
    ]);
    await expect(svc.lock('b', 'c')).rejects.toMatchObject({ status: 403 });
    em.query.mockReset().mockResolvedValueOnce([]).mockResolvedValueOnce([{ status: 'SUSPENDED' }]);
    await expect(svc.unlock('b', 'c')).rejects.toMatchObject({ status: 403 });
    // Nothing was written: only the lock and the status reads ran.
    expect(em.query.mock.calls.every(([sql]) => !/^\s*UPDATE/i.test(sql))).toBe(true);
  });

  it('history rejects a cursor that does not decode to a timestamp and a uuid', async () => {
    const { svc, ds } = build();
    const bad = Buffer.from('not-a-date|not-a-uuid').toString('base64url');
    await expect(svc.history(bad)).rejects.toMatchObject({ status: 400 });
    expect(ds.query).not.toHaveBeenCalled();
  });

  it('history caps the page at 100 rows and uses a fixed label for an unknown action', async () => {
    const query = vi
      .fn()
      .mockResolvedValue([
        { id: 'i1', action: 'PLATFORM_SOMETHING_NEW', actor_name: null, at: new Date(0), ts: 'x' },
      ]);
    const { svc } = build(query);
    const page = await svc.history(undefined, 5000);
    expect(query.mock.calls[0][1][2]).toBe(101); // 100 + 1 to detect a next page
    expect(page.data[0].label).toBe('Platform event');
    expect(page.nextCursor).toBeNull();
  });
});

import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as webpush from 'web-push';
import { PushService } from './push.service';
import { PushConfigService } from './push-config';

vi.mock('web-push', () => ({
  sendNotification: vi.fn(),
}));

function fakeRepo(subscriptions: any[]) {
  return {
    find: vi.fn().mockResolvedValue(subscriptions),
    save: vi.fn(async (v) => v),
    delete: vi.fn().mockResolvedValue({ affected: 1 }),
  } as any;
}

function fakePushConfig(enabled = true) {
  return { isPushEnabled: vi.fn().mockReturnValue(enabled) } as unknown as PushConfigService;
}

/**
 * [#554] Fan-out to every live device for a user, with per-endpoint
 * classification. Every case here backs an acceptance criterion from the
 * issue: mixed outcomes across subscriptions, pruning on 404/410,
 * transient failure counting on 429/5xx/network errors, and payload
 * validation for the same-origin url.
 */
describe('PushService', () => {
  const payload = { type: 'ANNOUNCEMENT', title: 'Hi', body: 'Hello there', url: '/inbox/1' };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns zeroed counts and does not send when push is disabled', async () => {
    const repo = fakeRepo([{ id: 'sub-1' }]);
    const service = new PushService(repo, fakePushConfig(false));

    const result = await service.sendToUser('user-1', 'tenant-1', payload);

    expect(result).toEqual({ accepted: 0, transient: 0, pruned: 0 });
    expect(repo.find).not.toHaveBeenCalled();
    expect(webpush.sendNotification).not.toHaveBeenCalled();
  });

  it('classifies mixed outcomes: accepted, pruned (410), transient (429)', async () => {
    const acceptedSub = {
      id: 'sub-accepted',
      endpoint: 'https://push.example/a',
      p256dh: 'p1',
      auth: 'a1',
      failure_count: 0,
      last_used_at: null,
    };
    const prunedSub = {
      id: 'sub-pruned',
      endpoint: 'https://push.example/b',
      p256dh: 'p2',
      auth: 'a2',
      failure_count: 0,
      last_used_at: null,
    };
    const transientSub = {
      id: 'sub-transient',
      endpoint: 'https://push.example/c',
      p256dh: 'p3',
      auth: 'a3',
      failure_count: 2,
      last_used_at: null,
    };
    const repo = fakeRepo([acceptedSub, prunedSub, transientSub]);
    const service = new PushService(repo, fakePushConfig(true));

    vi.mocked(webpush.sendNotification).mockImplementation(async (subscription: any) => {
      if (subscription.endpoint === acceptedSub.endpoint) {
        return { statusCode: 201 } as any;
      }
      if (subscription.endpoint === prunedSub.endpoint) {
        const error: any = new Error('Gone');
        error.statusCode = 410;
        throw error;
      }
      const error: any = new Error('Too Many Requests');
      error.statusCode = 429;
      throw error;
    });

    const result = await service.sendToUser('user-1', 'tenant-1', payload);

    expect(result).toEqual({ accepted: 1, transient: 1, pruned: 1 });

    // Accepted subscription's last_used_at is stamped.
    const savedAccepted = repo.save.mock.calls.find((c: any) => c[0].id === 'sub-accepted')[0];
    expect(savedAccepted.last_used_at).toBeInstanceOf(Date);

    // Pruned row is deleted, never saved.
    expect(repo.delete).toHaveBeenCalledWith({ id: 'sub-pruned' });

    // Transient row's failure_count is incremented, not deleted.
    const savedTransient = repo.save.mock.calls.find((c: any) => c[0].id === 'sub-transient')[0];
    expect(savedTransient.failure_count).toBe(3);
    expect(repo.delete).not.toHaveBeenCalledWith({ id: 'sub-transient' });
  });

  it('counts a delivery as accepted even when the bookkeeping save fails', async () => {
    // [thread coderabbitai#11] A `repo.save` rejection after a successful
    // sendNotification must not reclassify the delivery as transient — a
    // caller falling back on `accepted < 1` would otherwise send a paid
    // duplicate through the guardian's preferred channel.
    const sub = {
      id: 'sub-1',
      endpoint: 'https://push.example/a',
      p256dh: 'p1',
      auth: 'a1',
      failure_count: 0,
      last_used_at: null,
    };
    const repo = fakeRepo([sub]);
    repo.save.mockRejectedValueOnce(new Error('db unavailable'));
    const service = new PushService(repo, fakePushConfig(true));
    vi.mocked(webpush.sendNotification).mockResolvedValue({ statusCode: 201 } as any);

    const result = await service.sendToUser('user-1', 'tenant-1', payload);

    expect(result).toEqual({ accepted: 1, transient: 0, pruned: 0 });
  });

  it('continues the fan-out and preserves counts when a prune delete fails', async () => {
    // [thread coderabbitai#12] A rejected repo.delete for one subscription
    // must not escape the loop and skip the remaining subscriptions.
    const prunedSub = {
      id: 'sub-pruned',
      endpoint: 'https://push.example/a',
      p256dh: 'p1',
      auth: 'a1',
      failure_count: 0,
      last_used_at: null,
    };
    const acceptedSub = {
      id: 'sub-accepted',
      endpoint: 'https://push.example/b',
      p256dh: 'p2',
      auth: 'a2',
      failure_count: 0,
      last_used_at: null,
    };
    const repo = fakeRepo([prunedSub, acceptedSub]);
    repo.delete.mockRejectedValueOnce(new Error('db unavailable'));
    const service = new PushService(repo, fakePushConfig(true));
    vi.mocked(webpush.sendNotification).mockImplementation(async (subscription: any) => {
      if (subscription.endpoint === prunedSub.endpoint) {
        const error: any = new Error('Gone');
        error.statusCode = 410;
        throw error;
      }
      return { statusCode: 201 } as any;
    });

    const result = await service.sendToUser('user-1', 'tenant-1', payload);

    expect(result).toEqual({ accepted: 1, transient: 0, pruned: 1 });
  });

  it('throws on an absolute url instead of a same-origin path', async () => {
    const repo = fakeRepo([]);
    const service = new PushService(repo, fakePushConfig(true));

    await expect(
      service.sendToUser('user-1', 'tenant-1', { ...payload, url: 'https://evil.com/x' }),
    ).rejects.toThrow();
    expect(webpush.sendNotification).not.toHaveBeenCalled();
  });

  it('throws on a protocol-relative url', async () => {
    const repo = fakeRepo([]);
    const service = new PushService(repo, fakePushConfig(true));

    await expect(
      service.sendToUser('user-1', 'tenant-1', { ...payload, url: '//evil.com/x' }),
    ).rejects.toThrow();
  });

  it('throws on a url that does not start with a single "/"', async () => {
    const repo = fakeRepo([]);
    const service = new PushService(repo, fakePushConfig(true));

    await expect(
      service.sendToUser('user-1', 'tenant-1', { ...payload, url: 'inbox/1' }),
    ).rejects.toThrow();
  });
});

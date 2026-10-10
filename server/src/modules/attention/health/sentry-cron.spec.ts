import { describe, it, expect, vi, afterEach } from 'vitest';
import { sentryCronCheckIn } from './sentry-cron';

describe('sentryCronCheckIn', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('does nothing when the URL is unset (local dev)', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    await sentryCronCheckIn(undefined, 'ok');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('POSTs the status to the monitor URL', async () => {
    const fetchMock = vi.fn().mockResolvedValue({});
    vi.stubGlobal('fetch', fetchMock);
    await sentryCronCheckIn('https://sentry.example/cron/x', 'ok');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe('https://sentry.example/cron/x?status=ok');
    expect(fetchMock.mock.calls[0][1]).toMatchObject({ method: 'POST' });
  });

  it('never throws when fetch rejects', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network down')));
    await expect(sentryCronCheckIn('https://sentry.example/cron/x', 'ok')).resolves.toBeUndefined();
  });
});

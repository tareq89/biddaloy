import 'reflect-metadata';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { DemoLogProvider } from './demo-log.provider';

describe('DemoLogProvider', () => {
  afterEach(() => vi.restoreAllMocks());

  it('returns an accepted result with a synthetic demo-log message id', async () => {
    const result = await new DemoLogProvider().send({ to: '01711111111', body: 'hi' });
    expect(result).toMatchObject({ success: true, outcome: 'ACCEPTED' });
    expect(result.providerMessageId).toMatch(/^demo-log-/);
    expect(result.raw).toEqual({ provider: 'demo-log' });
  });

  it('does no network I/O', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    await new DemoLogProvider().send({ to: 'a@bmsc.example', body: 'hi', subject: 's' });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('logs only a masked recipient', async () => {
    const provider = new DemoLogProvider();
    const log = vi.spyOn(provider['logger'], 'log').mockImplementation(() => undefined);
    await provider.send({ to: '01711111111', body: 'hi' });
    expect(log).toHaveBeenCalledWith(expect.stringContaining('********111'));
    expect(log).not.toHaveBeenCalledWith(expect.stringContaining('01711111111'));
  });
});

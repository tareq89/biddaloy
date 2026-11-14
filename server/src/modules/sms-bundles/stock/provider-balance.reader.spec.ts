import { describe, it, expect, vi } from 'vitest';
import { ProviderBalanceReader, STALE_AFTER_MS } from './provider-balance.reader';

const NOW = new Date('2026-11-13T12:00:00Z');

const make = (opts: {
  provider?: unknown;
  throws?: boolean;
  reading?: unknown;
  cost?: number | null;
}) => {
  const resolver = {
    resolve: opts.throws
      ? vi.fn().mockRejectedValue(new Error('down'))
      : vi.fn().mockResolvedValue({ provider: opts.provider, config: {} }),
  };
  const ds = {
    getRepository: () => ({ findOne: vi.fn().mockResolvedValue(opts.reading ?? null) }),
  };
  const stock = { weightedAverageCostPaisaPerSms: vi.fn().mockResolvedValue(opts.cost ?? null) };
  return new ProviderBalanceReader(ds as never, resolver as never, stock as never);
};

const live = (res: unknown) => ({
  descriptor: { capabilities: ['balance'] },
  getBalance: vi.fn().mockResolvedValue(res),
});

describe('ProviderBalanceReader', () => {
  it('uses the live provider estimate when it answers', async () => {
    const r = await make({ provider: live({ amount: 10, estimateSms: 500 }) }).read(NOW);
    expect(r).toMatchObject({ sms: 500, source: 'PROVIDER', stale: false });
  });

  it('converts a money balance with the weighted cost when no estimate', async () => {
    // 100.00 taka = 10000 paisa at 20 paisa per SMS = 500 SMS.
    const r = await make({ provider: live({ amount: 100 }), cost: 20 }).read(NOW);
    expect(r.sms).toBe(500);
  });

  it('falls back to the entered reading when the provider throws', async () => {
    const reading = { sms_balance: 42, created_at: new Date(NOW.getTime() - 1000) };
    const r = await make({ throws: true, reading }).read(NOW);
    expect(r).toMatchObject({ sms: 42, source: 'ENTERED', stale: false });
  });

  it('falls back when the provider has no balance capability', async () => {
    const reading = { sms_balance: 7, created_at: NOW };
    const r = await make({ provider: { descriptor: { capabilities: [] } }, reading }).read(NOW);
    expect(r.source).toBe('ENTERED');
  });

  it('entered reading is stale only after 7 days', async () => {
    const at = (ms: number) => ({ sms_balance: 1, created_at: new Date(NOW.getTime() - ms) });
    expect((await make({ throws: true, reading: at(STALE_AFTER_MS) }).read(NOW)).stale).toBe(false);
    expect(
      (await make({ throws: true, reading: at(STALE_AFTER_MS + 60_000) }).read(NOW)).stale,
    ).toBe(true);
  });

  it('is UNKNOWN with nothing to read, and never throws', async () => {
    expect(await make({ throws: true }).read(NOW)).toEqual({
      sms: null,
      source: 'UNKNOWN',
      asOf: null,
      stale: false,
    });
  });
});

import { describe, it, expect, vi } from 'vitest';
import { SmsAllocationService } from './sms-allocation.service';

const make = (balance: number | null, promised: number) => {
  const ds = { query: vi.fn().mockResolvedValue([{ total: String(promised) }]) };
  const reader = { read: vi.fn().mockResolvedValue({ sms: balance }) };
  return new SmsAllocationService(ds as never, reader as never, {} as never);
};

describe('SmsAllocationService.isOversold', () => {
  it('UNKNOWN balance is not oversold, so a failed read never blocks a sale', async () => {
    expect(await make(null, 1_000_000).isOversold()).toBe(false);
  });
  it('oversold only when promised is strictly above the balance', async () => {
    expect(await make(100, 101).isOversold()).toBe(true);
    expect(await make(100, 100).isOversold()).toBe(false);
  });
});

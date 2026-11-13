import { describe, it, expect, vi } from 'vitest';
import { VatService } from './vat.service';

const svc = (v: unknown) =>
  new VatService({ get: vi.fn().mockResolvedValue(v), set: vi.fn() } as any);

describe('VatService.get', () => {
  it('missing row means VAT off', async () => {
    expect(await svc(undefined).get()).toEqual({ rate_bp: null, label: 'VAT', registration: null });
  });
  it('fills gaps and keeps what is set', async () => {
    expect(await svc({ rate_bp: 1500, registration: 'BIN-1' }).get()).toEqual({
      rate_bp: 1500,
      label: 'VAT',
      registration: 'BIN-1',
    });
  });
  it('set writes the billing.vat key', async () => {
    const settings: any = { get: vi.fn(), set: vi.fn() };
    const value = { rate_bp: 500, label: 'GST', registration: null };
    await new VatService(settings).set(value, 'u1');
    expect(settings.set).toHaveBeenCalledWith('billing.vat', value, 'u1');
  });
});

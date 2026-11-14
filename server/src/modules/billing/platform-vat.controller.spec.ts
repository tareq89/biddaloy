import 'reflect-metadata';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { ApprovalScope, AuditAction } from '@biddaloy/shared';
import { REQUIRE_APPROVAL_KEY } from '../auth/decorators/require-approval.decorator';
import { PlatformVatController } from './platform-vat.controller';
import { UpdateVatDto } from './dto/vat.dto';

const res: any = { setHeader: vi.fn() };
const req: any = { user: { sub: 'u1' } };

describe('PlatformVatController', () => {
  let vat: any, audit: any, c: PlatformVatController;
  beforeEach(() => {
    vat = {
      get: vi.fn().mockResolvedValue({ rate_bp: null, label: 'VAT', registration: 'B1' }),
      set: vi.fn().mockResolvedValue(undefined),
    };
    audit = { record: vi.fn().mockResolvedValue(undefined) };
    c = new PlatformVatController(vat, audit);
  });

  it('PUT needs a step-up token for PLATFORM_VAT', () => {
    expect(Reflect.getMetadata(REQUIRE_APPROVAL_KEY, PlatformVatController.prototype.update)).toBe(
      ApprovalScope.PLATFORM_VAT,
    );
  });

  it('GET answers off, no-store', async () => {
    expect(await c.get(res)).toEqual({
      enabled: false,
      rate_percent: null,
      label: 'VAT',
      registration: 'B1',
    });
    expect(res.setHeader).toHaveBeenCalledWith('Cache-Control', 'no-store');
  });

  it('PUT converts percent to basis points in whole numbers and audits old and new', async () => {
    const out = await c.update({ enabled: true, rate_percent: 15.25, label: 'GST' }, req);
    expect(vat.set).toHaveBeenCalledWith({ rate_bp: 1525, label: 'GST', registration: 'B1' }, 'u1');
    expect(out.rate_percent).toBe(15.25);
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: AuditAction.PLATFORM_VAT_CHANGED,
        old_values: { rate_bp: null, label: 'VAT', registration: 'B1' },
        new_values: { rate_bp: 1525, label: 'GST', registration: 'B1' },
      }),
    );
  });

  it('0.07 and 4.35 do not drift (float traps)', async () => {
    await c.update({ enabled: true, rate_percent: 4.35 }, req);
    expect(vat.set.mock.calls[0][0].rate_bp).toBe(435);
  });

  it('PUT off nulls the rate and keeps label and registration', async () => {
    vat.get.mockResolvedValue({ rate_bp: 1500, label: 'VAT', registration: 'B1' });
    await c.update({ enabled: false }, req);
    expect(vat.set).toHaveBeenCalledWith({ rate_bp: null, label: 'VAT', registration: 'B1' }, 'u1');
  });

  it('empty registration clears it', async () => {
    await c.update({ enabled: false, registration: ' ' }, req);
    expect(vat.set.mock.calls[0][0].registration).toBeNull();
  });
});

describe('UpdateVatDto', () => {
  const errs = async (o: object) =>
    (await validate(plainToInstance(UpdateVatDto, o))).map((e) => e.property);
  it('refuses a missing rate when enabled', async () => {
    expect(await errs({ enabled: true })).toContain('rate_percent');
  });
  it('refuses a zero rate', async () => {
    expect(await errs({ enabled: true, rate_percent: 0 })).toContain('rate_percent');
  });
  it('refuses a rate above 50', async () => {
    expect(await errs({ enabled: true, rate_percent: 50.01 })).toContain('rate_percent');
  });
  it('refuses a rate with 3 decimals', async () => {
    expect(await errs({ enabled: true, rate_percent: 5.123 })).toContain('rate_percent');
  });
  it('refuses an empty label', async () => {
    expect(await errs({ enabled: true, rate_percent: 5, label: '' })).toContain('label');
  });
  it('refuses a 21-char label', async () => {
    expect(await errs({ enabled: true, rate_percent: 5, label: 'x'.repeat(21) })).toContain(
      'label',
    );
  });
  it('refuses a 41-char registration', async () => {
    expect(await errs({ enabled: false, registration: 'x'.repeat(41) })).toContain('registration');
  });
  it('accepts the bounds and off with no rate', async () => {
    expect(await errs({ enabled: true, rate_percent: 0.01 })).toEqual([]);
    expect(await errs({ enabled: true, rate_percent: 50, label: 'VAT' })).toEqual([]);
    expect(await errs({ enabled: false })).toEqual([]);
  });
});

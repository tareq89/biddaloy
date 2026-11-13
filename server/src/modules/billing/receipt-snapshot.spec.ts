import { describe, it, expect } from 'vitest';
import { buildReceiptSnapshot, readReceiptSnapshot } from './receipt-snapshot';

const school = { name: 'S', address: 'Dhaka' };

describe('buildReceiptSnapshot', () => {
  it('freezes VAT amount and net at the rate in force', () => {
    const s = buildReceiptSnapshot(
      school,
      { rate_bp: 1500, label: 'VAT', registration: 'B1' },
      11_500,
    );
    expect(s.vat).toEqual({
      registration: 'B1',
      rate_bp: 1500,
      label: 'VAT',
      vat_paisa: 1500,
      net_paisa: 10_000,
    });
  });
  it('registration only: number kept, no amount', () => {
    const s = buildReceiptSnapshot(
      school,
      { rate_bp: null, label: 'VAT', registration: 'B1' },
      5000,
    );
    expect(s.vat).toMatchObject({
      registration: 'B1',
      rate_bp: null,
      vat_paisa: 0,
      net_paisa: 5000,
    });
  });
  it('nothing set: vat is null; coupon extras pass through', () => {
    const s = buildReceiptSnapshot(school, { rate_bp: null, label: 'VAT', registration: null }, 0, {
      coupon_code: 'FREE',
      discount_paisa: 500,
    });
    expect(s).toMatchObject({ vat: null, coupon_code: 'FREE', discount_paisa: 500 });
  });
  it('a later rate change cannot touch a built snapshot', () => {
    const vat = { rate_bp: 1500, label: 'VAT', registration: null as string | null };
    const s = buildReceiptSnapshot(school, vat, 11_500);
    vat.rate_bp = 500;
    expect(s.vat?.vat_paisa).toBe(1500);
    expect(readReceiptSnapshot(JSON.parse(JSON.stringify(s)))?.vat?.rate_bp).toBe(1500);
  });
});

describe('readReceiptSnapshot', () => {
  it('old shape: vat is a bare registration string', () => {
    expect(readReceiptSnapshot({ name: 'S', address: null, vat: 'BIN-9' })).toMatchObject({
      name: 'S',
      vat: { registration: 'BIN-9', rate_bp: null, vat_paisa: 0 },
    });
  });
  it('old shape with null vat, and missing fields', () => {
    expect(readReceiptSnapshot({ name: 'S', address: null, vat: null })?.vat).toBeNull();
    expect(readReceiptSnapshot({})).toMatchObject({
      name: null,
      address: null,
      vat: null,
      discount_paisa: 0,
    });
  });
  it('null in, null out', () => {
    expect(readReceiptSnapshot(null)).toBeNull();
  });
});

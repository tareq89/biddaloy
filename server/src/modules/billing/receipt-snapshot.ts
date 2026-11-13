import { vatIncluded } from './vat';
import type { VatSetting } from './vat.service';

export interface ReceiptVat {
  registration: string | null;
  rate_bp: number | null;
  label: string;
  vat_paisa: number;
  net_paisa: number;
}

/** What `receipt_snapshot` holds: frozen at payment, so a later setting change never edits a receipt. */
export interface ReceiptSnapshot {
  name: string | null;
  address: string | null;
  vat: ReceiptVat | null;
  coupon_code?: string | null;
  discount_paisa?: number;
}

/** The only writer of a snapshot. `paidPaisa` is the VAT-inclusive amount actually charged. */
export function buildReceiptSnapshot(
  school: { name: string; address: string | null },
  vat: VatSetting,
  paidPaisa: number,
  extra: { coupon_code?: string | null; discount_paisa?: number } = {},
): ReceiptSnapshot {
  const hasVat = vat.rate_bp !== null || vat.registration !== null;
  const vat_paisa = vat.rate_bp ? vatIncluded(paidPaisa, vat.rate_bp) : 0;
  return {
    name: school.name,
    address: school.address,
    vat: hasVat
      ? {
          registration: vat.registration,
          rate_bp: vat.rate_bp,
          label: vat.label,
          vat_paisa,
          net_paisa: paidPaisa - vat_paisa,
        }
      : null,
    ...extra,
  };
}

/** The only reader. Also takes the old shape (`vat` a bare registration string) and missing fields. */
export function readReceiptSnapshot(raw: unknown): ReceiptSnapshot | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  let vat: ReceiptVat | null = null;
  if (typeof r.vat === 'string' && r.vat) {
    vat = { registration: r.vat, rate_bp: null, label: 'VAT', vat_paisa: 0, net_paisa: 0 };
  } else if (r.vat && typeof r.vat === 'object') {
    const v = r.vat as Record<string, unknown>;
    vat = {
      registration: typeof v.registration === 'string' && v.registration ? v.registration : null,
      rate_bp: typeof v.rate_bp === 'number' ? v.rate_bp : null,
      label: typeof v.label === 'string' && v.label ? v.label : 'VAT',
      vat_paisa: typeof v.vat_paisa === 'number' ? v.vat_paisa : 0,
      net_paisa: typeof v.net_paisa === 'number' ? v.net_paisa : 0,
    };
  }
  return {
    name: typeof r.name === 'string' ? r.name : null,
    address: typeof r.address === 'string' ? r.address : null,
    vat,
    coupon_code: typeof r.coupon_code === 'string' ? r.coupon_code : null,
    discount_paisa: typeof r.discount_paisa === 'number' ? r.discount_paisa : 0,
  };
}

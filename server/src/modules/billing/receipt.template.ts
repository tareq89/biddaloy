import { escapeHtml } from '../invoices/invoice-print-format.util';

export interface ReceiptData {
  receiptNumber: string;
  orderId: string;
  schoolName: string;
  schoolAddress: string | null;
  seats: number;
  months: number;
  unitPricePaisa: number;
  amountPaisa: number;
  periodStart: string;
  periodEnd: string;
  method: string;
  reference: string | null;
  paidAt: Date;
  locale: 'en' | 'bn';
  /** `BILLING_VAT_REGISTRATION`: when set, a VAT line and the number are shown. */
  vatRegistration: string | null;
}

const BN_DIGITS = '০১২৩৪৫৬৭৮৯';

const COPY = {
  en: {
    title: 'Payment receipt',
    receipt: 'Receipt no.',
    date: 'Date',
    billedTo: 'Billed to',
    order: 'Order',
    item: 'Seats',
    detail: (seats: string, months: string, unit: string) =>
      `${seats} seats x ${months} months x ${unit} per seat per month`,
    period: 'Covers',
    total: 'Total paid',
    method: 'Payment method',
    ref: 'Reference',
    vat: 'VAT registration',
    vatLine: 'Amounts include VAT where applicable.',
    methods: {
      BKASH: 'bKash',
      OFFLINE_BANK: 'Bank transfer',
      OFFLINE_CASH: 'Cash',
      GRANT: 'Grant',
    } as Record<string, string>,
    legal: 'Issued by Biddaloy (school management platform). This receipt is computer generated.',
  },
  bn: {
    title: 'পেমেন্ট রসিদ',
    receipt: 'রসিদ নং',
    date: 'তারিখ',
    billedTo: 'যার নামে',
    order: 'অর্ডার',
    item: 'সিট',
    detail: (seats: string, months: string, unit: string) =>
      `${seats}টি সিট x ${months} মাস x প্রতি সিট প্রতি মাসে ${unit}`,
    period: 'মেয়াদ',
    total: 'মোট পরিশোধ',
    method: 'পেমেন্টের মাধ্যম',
    ref: 'রেফারেন্স',
    vat: 'ভ্যাট নিবন্ধন',
    vatLine: 'প্রযোজ্য ক্ষেত্রে ভ্যাটসহ।',
    methods: {
      BKASH: 'বিকাশ',
      OFFLINE_BANK: 'ব্যাংক ট্রান্সফার',
      OFFLINE_CASH: 'নগদ',
      GRANT: 'অনুদান',
    } as Record<string, string>,
    legal: 'বিদ্যালয় (স্কুল ম্যানেজমেন্ট প্ল্যাটফর্ম) কর্তৃক ইস্যুকৃত। এটি কম্পিউটারে তৈরি রসিদ।',
  },
};

function digits(s: string, locale: 'en' | 'bn'): string {
  return locale === 'bn' ? s.replace(/[0-9]/g, (d) => BN_DIGITS[Number(d)] as string) : s;
}

function money(paisa: number, locale: 'en' | 'bn'): string {
  const taka = (paisa / 100).toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  return digits(`৳${taka}`, locale);
}

/** A4, print-ready HTML (the browser saves it as PDF). Every value is escaped; no scripts run. */
export function renderReceiptHtml(d: ReceiptData): string {
  const c = COPY[d.locale];
  const n = (v: number | string) => digits(String(v), d.locale);
  const paid = new Intl.DateTimeFormat(d.locale === 'bn' ? 'bn-BD' : 'en-GB', {
    timeZone: 'Asia/Dhaka',
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(d.paidAt);
  const row = (k: string, v: string) =>
    `<tr><th>${escapeHtml(k)}</th><td>${escapeHtml(v)}</td></tr>`;
  return `<!doctype html>
<html lang="${d.locale}"><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'">
<title>${escapeHtml(d.receiptNumber)}</title>
<style>
@page{size:A4;margin:18mm}
body{font-family:system-ui,'Noto Sans Bengali',sans-serif;color:#111;max-width:170mm;margin:0 auto}
h1{font-size:20px;margin:0 0 4px}
table{width:100%;border-collapse:collapse;margin:16px 0}
th{text-align:start;font-weight:600;width:34%;padding:6px 0;vertical-align:top}
td{padding:6px 0}
.total td,.total th{border-top:2px solid #111;font-size:18px}
.muted{color:#555;font-size:12px}
</style></head><body>
<h1>Biddaloy</h1>
<div class="muted">${escapeHtml(c.title)}</div>
<table>
${row(c.receipt, d.receiptNumber)}
${row(c.date, n(paid))}
${row(c.billedTo, [d.schoolName, d.schoolAddress].filter(Boolean).join(', '))}
${row(c.order, d.orderId)}
${row(c.item, c.detail(n(d.seats), n(d.months), money(d.unitPricePaisa, d.locale)))}
${row(c.period, n(`${d.periodStart} - ${d.periodEnd}`))}
${row(c.method, c.methods[d.method] ?? d.method)}
${d.reference ? row(c.ref, d.reference) : ''}
${d.vatRegistration ? row(c.vat, d.vatRegistration) : ''}
<tr class="total"><th>${escapeHtml(c.total)}</th><td>${escapeHtml(money(d.amountPaisa, d.locale))}</td></tr>
</table>
${d.vatRegistration ? `<p class="muted">${escapeHtml(c.vatLine)}</p>` : ''}
<p class="muted">${escapeHtml(c.legal)}</p>
</body></html>`;
}

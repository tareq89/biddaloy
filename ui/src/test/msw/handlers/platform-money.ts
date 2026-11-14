import { http, HttpResponse } from 'msw';

import type { PlatformBundleOrder } from '../../../hooks/platform-billing';
import type { PlatformCoupon } from '../../../hooks/platform-coupons';
import type { PlatformRevenueReport } from '../../../hooks/platform-money-revenue';
import type { SmsPackage, SmsStateReport } from '../../../hooks/platform-money-sms';
import type { PlatformPlan } from '../../../hooks/platform-plans';

/**
 * Cockpit money routes (Epic 100 W2-W3). Fake data only: invented school names, no real phone or
 * email. Money is whole paisa. The fixtures cover every state a screen shows: all four action-line
 * kinds, a school below the red line, a stale provider balance, a package switched off, an
 * exhausted coupon, and refunded seat/package orders with the refund netted in the month.
 */
const ID = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

export const MONEY_SCHOOL_LOW = ID(301);
export const MONEY_SCHOOL_OK = ID(302);

export const smsReportFixture: SmsStateReport = {
  actionLines: [
    {
      code: 'TOP_UP_NOW',
      tone: 'danger',
      params: { sms: 800 },
      target: { kind: 'tab', tab: 'stock' },
    },
    {
      code: 'SCHOOLS_LOW',
      tone: 'warning',
      params: { count: 1 },
      target: { kind: 'school', schoolId: MONEY_SCHOOL_LOW },
    },
    {
      code: 'SMS_EXPIRING',
      tone: 'warning',
      params: { sms: 300, days: 5 },
      target: { kind: 'tab', tab: 'report' },
    },
    {
      code: 'OVERSOLD',
      tone: 'danger',
      params: { sms: 1200 },
      target: { kind: 'tab', tab: 'stock' },
    },
  ],
  // Entered 12 days ago: past the 7-day stale line.
  balance: { sms: 800, kind: 'ENTERED', enteredAt: '2029-12-18T00:00:00.000Z', stale: true },
  totals: {
    boughtSms: 50000,
    soldSms: 30000,
    usedSms: 12000,
    expiredSms: 1000,
    promisedUnusedSms: 17000,
    unsoldSms: 20000,
    revenuePaisa: 6_000_000,
    costPaisa: 2_500_000,
    marginPaisa: 3_500_000,
  },
  packages: [
    {
      catalogId: ID(311),
      name: 'Starter 1000',
      orders: 12,
      soldSms: 12000,
      revenuePaisa: 2_400_000,
      costPaisa: 1_000_000,
      marginPaisa: 1_400_000,
    },
  ],
  schools: [
    {
      schoolId: MONEY_SCHOOL_LOW,
      schoolName: 'Rose Valley School',
      orders: 3,
      soldSms: 3000,
      usedSms: 2950,
      expiredSms: 0,
      revenuePaisa: 600_000,
      costPaisa: 250_000,
      marginPaisa: 350_000,
      failedSms: 20,
      sentSms: 2930,
      failureRateBp: 68,
    },
    {
      schoolId: MONEY_SCHOOL_OK,
      schoolName: 'Green Hill School',
      orders: 1,
      soldSms: 5000,
      usedSms: 100,
      expiredSms: 0,
      revenuePaisa: 1_000_000,
      costPaisa: 420_000,
      marginPaisa: 580_000,
      failedSms: 0,
      sentSms: 100,
      failureRateBp: null,
    },
  ],
  nextCursor: null,
};

export const smsPackageFixtures: SmsPackage[] = [
  {
    id: ID(311),
    name: 'Starter 1000',
    smsCount: 1000,
    validityDays: 180,
    pricePaisa: '200000',
    priceTaka: '2000.00',
    active: true,
  },
  // Switched off: not offered to schools.
  {
    id: ID(312),
    name: 'Legacy 500',
    smsCount: 500,
    validityDays: 90,
    pricePaisa: '120000',
    priceTaka: '1200.00',
    active: false,
  },
];

export const planFixtures: PlatformPlan[] = [
  { id: ID(321), name: 'Standard', unit_price_paisa: 5000, active: true, is_default: true },
  { id: ID(322), name: 'Old plan', unit_price_paisa: 4000, active: false, is_default: false },
];

const coupon = (n: number, over: Partial<PlatformCoupon>): PlatformCoupon => ({
  id: ID(330 + n),
  code: `WELCOME${n}0`,
  discount_kind: 'PERCENT',
  percent: 10,
  fixed_paisa: null,
  max_months: null,
  max_discount_paisa: null,
  min_order_paisa: null,
  scope: 'ALL',
  max_uses: null,
  uses_count: 0,
  per_school_max: 1,
  starts_at: '2029-01-01T00:00:00.000Z',
  ends_at: '2030-12-31T00:00:00.000Z',
  active: true,
  created_at: '2029-01-01T00:00:00.000Z',
  ...over,
});
export const couponFixtures: PlatformCoupon[] = [
  coupon(1, { uses_count: 3 }),
  // Exhausted: every use is spent.
  coupon(2, { max_uses: 5, uses_count: 5 }),
];

export const bundleOrderFixtures: PlatformBundleOrder[] = [
  {
    id: ID(341),
    status: 'ACTIVE',
    bundle_name: 'Starter 1000',
    sms_count: 1000,
    amount_paisa: 200000,
    receipt_number: 'R-0001',
    paid_at: '2029-12-01T00:00:00.000Z',
    refunded_at: null,
    units_bought: 1000,
    units_used: 0,
    refundable: true,
  },
  {
    id: ID(342),
    status: 'REFUNDED',
    bundle_name: 'Legacy 500',
    sms_count: 500,
    amount_paisa: 120000,
    receipt_number: 'R-0002',
    paid_at: '2029-11-01T00:00:00.000Z',
    refunded_at: '2029-11-02T00:00:00.000Z',
    units_bought: 500,
    units_used: 0,
    refundable: false,
  },
];

export const revenueFixture: PlatformRevenueReport = {
  month: '2029-12',
  seat_income_paisa: 900_000,
  package_income_paisa: 320_000,
  // Both refunds (one seat order, one package order) are already taken off `net_paisa`.
  refunds_paisa: 170_000,
  net_paisa: 1_050_000,
  paying_schools: 7,
  not_renewed: {
    items: [
      {
        school_id: MONEY_SCHOOL_LOW,
        name: 'Rose Valley School',
        paid_until: '2029-11-30',
        days_since_ended: 30,
        plan: 'Standard',
      },
    ],
    next_cursor: null,
  },
};

const csv = (name: string, body: string) =>
  new HttpResponse(body, {
    headers: {
      'Content-Type': 'text/csv',
      'Content-Disposition': `attachment; filename="${name}"`,
    },
  });

export const platformMoneyDefaultHandlers = [
  http.get('*/platform/money/sms', ({ request }) =>
    new URL(request.url).searchParams.get('format') === 'csv'
      ? csv('sms-state-report.csv', 'school,sold\nRose Valley School,3000\n')
      : HttpResponse.json(smsReportFixture),
  ),
  http.get('*/platform/sms-packages', () => HttpResponse.json(smsPackageFixtures)),
  http.post('*/platform/sms-packages', async ({ request }) => {
    const b = (await request.json()) as {
      name: string;
      smsCount: number;
      validityDays: number;
      priceTaka: number;
    };
    return HttpResponse.json(
      {
        id: ID(319),
        ...b,
        pricePaisa: String(Math.round(b.priceTaka * 100)),
        priceTaka: b.priceTaka.toFixed(2),
        active: true,
      },
      { status: 201 },
    );
  }),
  http.patch('*/platform/sms-packages/:id', async ({ params, request }) => {
    const base = smsPackageFixtures.find((p) => p.id === params.id) ?? smsPackageFixtures[0]!;
    return HttpResponse.json({ ...base, ...((await request.json()) as object) });
  }),
  http.post('*/platform/sms-packages/:id/active', async ({ params, request }) => {
    const base = smsPackageFixtures.find((p) => p.id === params.id) ?? smsPackageFixtures[0]!;
    return HttpResponse.json({ ...base, ...((await request.json()) as object) });
  }),
  http.get('*/platform/sms-stock/balance', () =>
    HttpResponse.json({
      sms: 800,
      source: 'ENTERED',
      asOf: '2029-12-18T00:00:00.000Z',
      stale: true,
    }),
  ),
  http.post('*/platform/sms-stock/balance', () => HttpResponse.json({ ok: true })),
  http.get('*/platform/sms-stock', () =>
    HttpResponse.json({
      items: [
        {
          id: ID(351),
          boughtOn: '2029-12-01',
          smsCount: 50000,
          costPaisa: '2500000',
          note: null,
          createdAt: '2029-12-01T00:00:00.000Z',
        },
      ],
      nextCursor: null,
    }),
  ),
  http.post('*/platform/sms-stock', async ({ request }) => {
    const b = (await request.json()) as {
      boughtOn: string;
      smsCount: number;
      costTaka: number;
      note?: string;
    };
    return HttpResponse.json(
      {
        id: ID(352),
        boughtOn: b.boughtOn,
        smsCount: b.smsCount,
        costPaisa: String(Math.round(b.costTaka * 100)),
        note: b.note ?? null,
        createdAt: '2029-12-30T00:00:00.000Z',
      },
      { status: 201 },
    );
  }),
  http.delete('*/platform/sms-stock/:id', () => new HttpResponse(null, { status: 204 })),

  http.get('*/platform/plans', () => HttpResponse.json(planFixtures)),
  http.post('*/platform/plans', async ({ request }) =>
    HttpResponse.json(
      { id: ID(329), active: true, is_default: false, ...((await request.json()) as object) },
      { status: 201 },
    ),
  ),
  http.patch('*/platform/plans/:id', async ({ params, request }) => {
    const base = planFixtures.find((p) => p.id === params.id) ?? planFixtures[0]!;
    return HttpResponse.json({ ...base, ...((await request.json()) as object) });
  }),
  http.post('*/platform/plans/:id/make-default', ({ params }) => {
    const base = planFixtures.find((p) => p.id === params.id) ?? planFixtures[0]!;
    return HttpResponse.json({ ...base, is_default: true });
  }),
  http.post('*/platform/billing/schools/:id/plan', () =>
    HttpResponse.json({ planId: planFixtures[0]!.id, name: 'Standard', unitPricePaisa: 5000 }),
  ),

  http.get('*/platform/coupons/:id/usage', () =>
    HttpResponse.json({
      uses: 3,
      totalDiscountPaisa: '150000',
      schools: {
        items: [
          {
            schoolId: MONEY_SCHOOL_LOW,
            schoolName: 'Rose Valley School',
            uses: 3,
            discountPaisa: '150000',
          },
        ],
        nextCursor: null,
      },
    }),
  ),
  http.get('*/platform/coupons', () =>
    HttpResponse.json({ items: couponFixtures, nextCursor: null }),
  ),
  http.post('*/platform/coupons/free', async ({ request }) =>
    HttpResponse.json(
      coupon(9, { code: ((await request.json()) as { code: string }).code, percent: 100 }),
      { status: 201 },
    ),
  ),
  http.post('*/platform/coupons', async ({ request }) =>
    HttpResponse.json(coupon(8, { code: ((await request.json()) as { code: string }).code }), {
      status: 201,
    }),
  ),
  http.patch('*/platform/coupons/:id', async ({ params, request }) => {
    const base = couponFixtures.find((c) => c.id === params.id) ?? couponFixtures[0]!;
    return HttpResponse.json({ ...base, ...((await request.json()) as object) });
  }),

  http.get('*/platform/money/revenue', ({ request }) =>
    new URL(request.url).searchParams.get('format') === 'csv'
      ? csv('revenue-2029-12.csv', 'school,net\nRose Valley School,1050000\n')
      : HttpResponse.json(revenueFixture),
  ),
  http.get('*/platform/money/vat', () =>
    HttpResponse.json({
      enabled: true,
      rate_percent: 15,
      label: 'VAT',
      registration: 'BIN-0000000000',
    }),
  ),
  http.put('*/platform/money/vat', async ({ request }) =>
    HttpResponse.json({
      label: 'VAT',
      registration: null,
      rate_percent: null,
      ...((await request.json()) as object),
    }),
  ),

  http.post('*/platform/billing/orders/:id/refund', ({ params }) =>
    HttpResponse.json({
      applied: true,
      order_id: params.id,
      gateway_ref: null,
      note: 'Refund the money in the bKash panel.',
    }),
  ),
  http.post('*/platform/billing/sms-bundle-orders/:id/refund', ({ params }) =>
    HttpResponse.json({
      applied: true,
      order_id: params.id,
      gateway_ref: null,
      note: 'Refund the money in the bKash panel.',
    }),
  ),
];

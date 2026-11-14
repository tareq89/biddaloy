import { http, HttpResponse } from 'msw';

import { apiErrorBody, paginate } from '../support';

import { smsCreditsExtras } from './communications';

// [100.4.01] School-side SMS package endpoints. Fake data only.
const PACKAGES = [
  ['Small', 500, 90, '50000'],
  ['Medium', 2000, 180, '180000'],
  ['Large', 10000, 365, '800000'],
].map(([name, smsCount, validityDays, pricePaisa], i) => ({
  id: `00000000-0000-4000-8000-00000000010${i}`,
  name,
  smsCount,
  validityDays,
  pricePaisa,
  priceTaka: String(Number(pricePaisa) / 100),
  active: true,
}));

function orderFor(pkg: (typeof PACKAGES)[number], overrides: Record<string, unknown> = {}) {
  return {
    id: '00000000-0000-4000-8000-0000000002aa',
    packageId: pkg.id,
    name: pkg.name,
    smsCount: pkg.smsCount,
    validityDays: pkg.validityDays,
    pricePaisa: pkg.pricePaisa,
    costPaisaPerSms: null,
    status: 'PENDING',
    createdAt: '2026-11-01T06:00:00.000Z',
    paidAt: null,
    cancelledAt: null,
    ...overrides,
  };
}

const catalog = http.get('/api/v1/sms-bundles/catalog', () => HttpResponse.json(PACKAGES));

const listOrders = http.get('/api/v1/sms-bundles/orders', () =>
  HttpResponse.json([
    orderFor(PACKAGES[1]!, { status: 'PAID', paidAt: '2026-11-01T06:05:00.000Z' }),
  ]),
);

const createOrder = http.post('/api/v1/sms-bundles/orders', async ({ request }) => {
  const { package_id } = (await request.json()) as { package_id: string };
  const pkg = PACKAGES.find((p) => p.id === package_id);
  if (!pkg) {
    return HttpResponse.json(apiErrorBody(404, 'Not found', '/api/v1/sms-bundles/orders'), {
      status: 404,
    });
  }
  return HttpResponse.json(orderFor(pkg), { status: 201 });
});

const payBkash = http.post('/api/v1/sms-bundles/orders/:id/pay/bkash', () =>
  HttpResponse.json({ bkash_url: 'https://bkash.example.test/checkout/demo' }),
);

const getSource = http.get('/api/v1/communications/sms-source', () =>
  HttpResponse.json({ source: 'SCHOOLMANAGERP', ownProviderSaved: false }),
);

const putSource = http.put('/api/v1/communications/sms-source', async ({ request }) => {
  const { source } = (await request.json()) as { source: string };
  return HttpResponse.json({ source, ownProviderSaved: true });
});

const lot = (remaining: number, expires_at: string | null) => ({
  id: '00000000-0000-4000-8000-0000000003aa',
  source: 'bundle',
  units_total: 2000,
  remaining,
  expires_at,
});

const credits = (over: Record<string, unknown>, available: number) =>
  http.get('/api/v1/communications/sms-credits', ({ request }) =>
    HttpResponse.json({
      metering: 'PLATFORM',
      available,
      reserved: 0,
      ledger: paginate([], request.url),
      ...smsCreditsExtras(over),
    }),
  );

/** One school per state; `server.use(smsBundleHandlers.creditsAlmostFinished)` etc. */
export const smsBundleHandlers = {
  creditsOwnProvider: credits({ source: 'OWN' }, 0),
  creditsSchoolManagerP: credits({ lots: [lot(1500, '2027-06-01T00:00:00.000Z')] }, 1500),
  creditsAlmostFinished: credits(
    { lots: [lot(40, '2027-06-01T00:00:00.000Z')], almostFinished: true },
    40,
  ),
  creditsNothingLeft: credits({ lots: [lot(0, '2027-06-01T00:00:00.000Z')], stopped: true }, 0),
  creditsLotAboutToExpire: credits({ lots: [lot(900, '2026-11-20T00:00:00.000Z')] }, 900),
};

export const smsBundleDefaultHandlers = [
  catalog,
  listOrders,
  createOrder,
  payBkash,
  getSource,
  putSource,
];

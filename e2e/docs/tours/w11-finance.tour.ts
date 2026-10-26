/**
 * [Epic 42 / W11] The finance shots that needed arranged data: a reversed payment,
 * a two-sibling payment, the guardian's receipt on a phone. Demo school; the reversal
 * and the siblings' payment are made with the app's own API (the demo only blocks the
 * "send me a code" step, so the approver proves themselves by password instead).
 */
import { devices, test, type Locator, type Page } from '@playwright/test';

import { imgDir, prepare, requireEnv } from '../helpers/capture';
import { asRole, go, snap, step, tr } from '../helpers/nav';

const dir = imgDir('finance');
const f = (name: string) => `${dir}/${name}.png`;

/** Headers the app itself sent on an API call, to replay a request with the same sign-in. */
function captureHeaders(page: Page): () => Record<string, string> {
  let headers: Record<string, string> = {};
  page.on('request', (r) => {
    const h = r.headers();
    if (r.url().includes('/api/') && h['authorization']) headers = h;
  });
  return () => {
    const { host: _h, cookie: _c, 'content-length': _l, ...rest } = headers;
    return rest;
  };
}

const NORMAL = { width: 1440, height: 900 };

/** `snap` clipped to the callout targets (plus a margin), so text stays legible at page width. */
async function snapTight(
  page: Page,
  file: string,
  callouts: { target: Locator }[],
  skipLast = false,
): Promise<void> {
  const boxes = (
    await Promise.all(
      (skipLast ? callouts.slice(0, -1) : callouts).map((c) => c.target.boundingBox()),
    )
  ).filter((b) => b !== null);
  const x0 = Math.max(0, Math.min(...boxes.map((b) => b.x)) - 36);
  const y0 = Math.max(0, Math.min(...boxes.map((b) => b.y)) - 36);
  const x1 = Math.max(...boxes.map((b) => b.x + b.width)) + 36;
  const y1 = Math.max(...boxes.map((b) => b.y + b.height)) + 36;
  await snap(page, file, callouts, { region: { x: x0, y: y0, width: x1 - x0, height: y1 - y0 } });
}

test.describe.configure({ mode: 'serial' });

test('finance W11: reversal list', async ({ browser }, info) => {
  test.skip(info.project.metadata.device !== 'desktop');
  test.setTimeout(900_000);
  const page = await asRole(browser, info, 'admin');
  const headers = captureHeaders(page);
  const main = page.getByRole('main');
  await go(page, '/payments');
  await page.waitForTimeout(1500);

  await step('reverse-api', async () => {
    const h = headers();
    const list = await page.request.get('/api/v1/payments?limit=5', { headers: h });
    const body = (await list.json()) as {
      data?: { id: string; status: string }[];
      items?: { id: string; status: string }[];
    };
    const rows = body.data ?? body.items ?? [];
    const target = rows.find((r) => r.status !== 'REVERSED') ?? rows[0];
    const su = await page.request.post('/api/v1/auth/step-up', {
      headers: h,
      data: {
        identifier: 'admin@bmsc.example',
        method: 'PASSWORD',
        password: requireEnv('DEMO_PASSWORD', 'the demo school password'),
        scope: 'payments.reverse',
      },
    });
    const suBody = (await su.json()) as { approval_token: string };
    console.log('SHOT_OK STEPUP', su.status());
    const token = suBody.approval_token;
    const rev = await page.request.post(`/api/v1/payments/${target.id}/reverse`, {
      headers: { ...h, 'x-approval-token': token },
      data: { reason: 'Paid twice by mistake' },
    });
    console.log('SHOT_OK REVERSE', rev.status());
  });

  await step('payments-list-reversed', async () => {
    await go(page, '/payments');
    await main.getByRole('checkbox', { name: tr('payments', 'list.includeReversed') }).check();
    await page.waitForTimeout(1500);
    await snap(page, f('payments-02-reversed'), [
      { target: main.getByRole('heading', { level: 1 }) },
      {
        target: main
          .locator('div')
          .filter({ has: page.getByRole('textbox') })
          .filter({ has: page.getByRole('checkbox') })
          .last(),
      },
      { target: main.locator('table') },
    ]);
  });
});

test('finance W11: record payment, two siblings', async ({ browser }, info) => {
  test.skip(info.project.metadata.device !== 'desktop');
  test.setTimeout(900_000);
  const page = await asRole(browser, info, 'accountant');
  await step('record-payment-siblings', async () => {
    await go(page, '/payments/record');
    await page.getByRole('textbox').first().fill('Nabil');
    await page.waitForTimeout(1500);
    await page.getByText('Nabil Rahman').first().click();
    await page.waitForTimeout(1800);
    await page.getByRole('textbox').first().fill('Tasin');
    await page.waitForTimeout(1500);
    await page.getByText('Tasin Rahman').first().click();
    await page.waitForTimeout(1800);
    await page.setViewportSize({ width: 1440, height: 2000 });
    await page.getByRole('textbox').nth(1).fill('1570');
    await page.waitForTimeout(800);
    await page.getByRole('textbox').nth(6).fill('2000');
    await page.waitForTimeout(800);
    await snapTight(
      page,
      f('record-payment-02-siblings'),
      [0, 1, 2]
        .map((i) => ({
          target: page.locator('form section.rounded-lg').nth(i),
        }))
        .concat([{ target: page.getByRole('button').last() }]),
      true,
    );
    await page.setViewportSize(NORMAL);
  });
});

test('finance W11: guardian receipt on a phone', async ({ browser }, info) => {
  test.skip(info.project.metadata.device !== 'desktop');
  test.setTimeout(900_000);
  const page = await asRole(browser, info, 'accountant');
  const headers = captureHeaders(page);
  await go(page, '/payments');
  await page.waitForTimeout(1500);
  await step('receipt-phone', async () => {
    const h = headers();
    const list = await page.request.get('/api/v1/invoices?limit=5', { headers: h });
    const body = (await list.json()) as { data?: { id: string }[]; items?: { id: string }[] };
    const inv = (body.data ?? body.items ?? [])[0];
    const share = await page.request.post(`/api/v1/invoices/${inv.id}/share`, { headers: h });
    const url = ((await share.json()) as { url: string }).url;
    const path = new URL(url).pathname;
    const ctx = await browser.newContext({
      ...devices['Pixel 7'],
      locale: info.project.use.locale,
      viewport: { width: 390, height: 844 },
      deviceScaleFactor: 2,
      baseURL: process.env.GUIDE_BASE_URL ?? 'http://localhost:5174',
    });
    const ph = await ctx.newPage();
    await prepare(ph);
    await ph.goto(path);
    await ph.waitForTimeout(2500);
    await snap(ph, f('invoices-02-receipt-phone'), []);
    await ctx.close();
  });
});

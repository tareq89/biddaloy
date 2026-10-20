import { expect, test } from '@playwright/test';

// D21: the site never names a payment provider or asks for a card.
// ("No card needed" and "ID cards" are fine; pricing.test.ts guards the pricing copy.)
// Checked on the raw HTML (hidden text, alt text and JSON-LD included) and on the visible text.
for (const path of ['/bn/', '/en/', '/bn/pricing/', '/en/pricing/', '/en/features/']) {
  test(`${path} has no payment-provider words`, async ({ page, request }) => {
    const html = (await (await request.get(path)).text()).toLowerCase();
    expect(html).not.toMatch(/bkash|nagad|sslcommerz/);
    await page.goto(path);
    const text = (await page.locator('body').innerText()).toLowerCase();
    expect(text).not.toMatch(/bkash|nagad|sslcommerz|(credit|debit|payment|visa) card|card (number|payment)/);
  });
}

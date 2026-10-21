import { expect, test } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

const PAGES = [
  '/bn/',
  '/en/',
  '/bn/pricing/',
  '/bn/features/',
  '/bn/for/madrasa/',
  '/bn/contact/',
  '/bn/privacy/',
  '/bn/terms/',
];

test('/ redirects to the Bangla home', async ({ page }) => {
  await page.goto('/');
  await expect(page).toHaveURL(/\/bn\/$/);
  await expect(page.locator('html')).toHaveAttribute('lang', 'bn');
});

for (const path of PAGES) {
  test(`${path} has hreflang pairs and no axe violations`, async ({ page }) => {
    await page.goto(path);
    const rest = path.replace(/^\/(bn|en)/, '');
    for (const l of ['bn', 'en']) {
      await expect(page.locator(`link[rel="alternate"][hreflang="${l}"]`)).toHaveAttribute(
        'href',
        `https://schoolmanagerp.com/${l}${rest}`,
      );
    }
    await expect(page.locator('link[rel="alternate"][hreflang="x-default"]')).toHaveAttribute(
      'href',
      'https://schoolmanagerp.com/bn' + rest,
    );
    const { violations } = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
      .analyze();
    expect(
      violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`),
    ).toEqual([]);
  });

  test(`${path} does not scroll sideways at 390 px`, async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(path);
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);
  });
}

test('every internal link on the two home pages answers 200', async ({ page, request }) => {
  const paths = new Set<string>();
  for (const start of ['/bn/', '/en/']) {
    await page.goto(start);
    const hrefs = await page.$$eval('a[href]', (as) =>
      as.map((a) => (a as HTMLAnchorElement).href),
    );
    for (const h of hrefs) {
      const u = new URL(h);
      if (u.origin === new URL(page.url()).origin) paths.add(u.pathname);
    }
  }
  expect(paths.size).toBeGreaterThan(5);
  for (const p of [...paths])
    expect((await request.get(p)).status(), p).toBe(200);
});

test('seo files are served and the sitemap hides the unlisted testimonials page', async ({
  request,
}) => {
  const robots = await (await request.get('/robots.txt')).text();
  expect(robots).toContain('Sitemap: https://schoolmanagerp.com/sitemap-index.xml');
  const sitemap = await (await request.get('/sitemap-0.xml')).text();
  expect(sitemap).toContain('https://schoolmanagerp.com/bn/pricing/');
  expect(sitemap).not.toContain('/testimonials/'); // SHOW_TESTIMONIALS = false (D13)
  const llms = await (await request.get('/llms.txt')).text();
  expect(llms).toMatch(/^# SchoolManager ERP/);
  expect(llms).not.toContain('/testimonials/');
});

test('home page carries Organization, SoftwareApplication (৳10) and FAQPage JSON-LD', async ({
  page,
}) => {
  await page.goto('/en/');
  const raw = await page.locator('script[type="application/ld+json"]').first().textContent();
  const graph = JSON.parse(raw!)['@graph'] as {
    '@type': string;
    offers?: { price: string; priceCurrency: string };
    mainEntity?: unknown[];
  }[];
  expect(graph.map((g) => g['@type'])).toEqual(['Organization', 'SoftwareApplication', 'FAQPage']);
  expect(graph[1].offers).toMatchObject({ price: '10', priceCurrency: 'BDT' });
  expect(graph[2].mainEntity!.length).toBeGreaterThanOrEqual(5);
});

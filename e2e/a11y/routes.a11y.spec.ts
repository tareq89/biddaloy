import AxeBuilder from '@axe-core/playwright';
import type { APIRequestContext, Page } from '@playwright/test';

import { adminApiSession, createStudentWithDues } from '../api';
import { expect, guest, loggedIn, test } from '../fixtures/test';
import type { SeedRole } from '../seed-contract';
import { resolvePath, routes } from '../responsive/routes';
import { overlayOpeners } from './overlay-openers';

/**
 * [8.5.5] Route-level axe suite — BLOCKING. Scans every manifest route
 * (and every named overlay state, open) at the five-tag WCAG set, in
 * both locales. [8.13.12] adds a third variant — `bn` in dark mode, see
 * `VARIANTS`'s own comment below for why it is one locale rather than
 * both. Suppressions only via `exceptions.ts`'s time-boxed
 * `a11yException` passed to `.disableRules()` — none are currently in
 * effect.
 */

const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];
const LOCALES = ['bn', 'en'] as const;

/**
 * [8.13.12]: every route/overlay combination also needs an axe pass in
 * dark mode — the dark `-bg` status tints this ticket adds are exactly the
 * kind of thing only a real accessibility scan, not `check-contrast.mjs`'s
 * pairwise math, catches wired to the wrong element. Full `LOCALES` x
 * `theme` coverage would double this suite's already-substantial runtime
 * for a dimension that (per `docs/architecture/09-design-direction.md`'s
 * ground/surface inversion) recolors tokens uniformly rather than
 * reflowing layout the way a locale swap can — so only one locale, `bn`
 * (the platform default, `i18n/locale-storage.ts`'s `DEFAULT_LOCALE`),
 * also runs the dark variant. `en` stays light-only.
 */
type Variant = { locale: (typeof LOCALES)[number]; theme: 'light' | 'dark' };
const VARIANTS: Variant[] = [
  ...LOCALES.map((locale): Variant => ({ locale, theme: 'light' })),
  { locale: 'bn', theme: 'dark' },
];

function formatViolations(violations: Awaited<ReturnType<AxeBuilder['analyze']>>['violations']) {
  return violations
    .map(
      (v) =>
        `${v.id} (${v.impact ?? 'n/a'}): ${v.help}\n` +
        v.nodes.map((n) => `    ${n.target.join(' ')}`).join('\n'),
    )
    .join('\n');
}

async function expectNoViolations(page: Page, include?: string): Promise<void> {
  let builder = new AxeBuilder({ page }).withTags(TAGS);
  if (include) builder = builder.include(include);
  const results = await builder.analyze();
  expect(results.violations, `axe violations:\n${formatViolations(results.violations)}`).toEqual(
    [],
  );
}

async function ensureDuesRow(request: APIRequestContext): Promise<void> {
  const session = await adminApiSession(request);
  await createStudentWithDues(request, session, `A11y Dues ${Date.now()}`);
}

for (const { locale, theme } of VARIANTS) {
  test.describe(`a11y · ${locale}${theme === 'dark' ? ' · dark' : ''}`, () => {
    for (const route of routes) {
      test.describe(route.path, () => {
        if (route.role === 'guest') {
          test.use({ ...guest, e2eLocale: locale });
        } else if (route.path === '/select-school') {
          // The picker only renders for a session with no persisted tenant.
          test.use({ ...loggedIn(route.role as SeedRole, { tenant: 'none' }), e2eLocale: locale });
        } else {
          test.use({ ...loggedIn(route.role as SeedRole), e2eLocale: locale });
        }

        test('has zero axe violations', async ({ page, request }) => {
          if (route.path === '/fees/dues' || route.path === '/students') {
            // Overlay openers below select the first row — make sure one exists.
            if (route.overlays?.length) await ensureDuesRow(request);
          }
          if (theme === 'dark') {
            // Seeded via `addInitScript`, not a plain `localStorage.setItem`
            // after `goto()` — it has to be in place before
            // `client-admin/index.html`'s boot script reads it on the very
            // first navigation, the same requirement `theme-toggle.spec.ts`
            // and `color-scheme.spec.ts` document for the same call.
            await page.addInitScript(() => localStorage.setItem('biddaloy:theme', 'dark'));
          }
          const path = await resolvePath(request, route);
          await page.goto(path);
          await expect(page.getByRole('heading', { level: 1 }).first()).toBeVisible();
          if (theme === 'dark') {
            expect(
              await page.evaluate(() => document.documentElement.getAttribute('data-theme')),
            ).toBe('dark');
          }
          await expectNoViolations(page);

          for (const overlay of route.overlays ?? []) {
            await test.step(`overlay ${overlay} open`, async () => {
              const opener = overlayOpeners[`${route.path}::${overlay}`];
              if (!opener) throw new Error(`no opener for ${route.path}::${overlay}`);
              await opener(page, locale);
              await expectNoViolations(page, '[role="dialog"]');
              await page.keyboard.press('Escape');
            });
          }
        });
      });
    }
  });
}

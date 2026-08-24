import AxeBuilder from '@axe-core/playwright';
import type { APIRequestContext, Page } from '@playwright/test';

import {
  adminApiSession,
  createClassSection,
  createGuardian,
  createInvoice,
  createStudentWithDues,
  type ApiSession,
} from '../api';
import { expect, guest, loggedIn, test } from '../fixtures/test';
import type { SeedRole } from '../seed-contract';
import manifest from '../route-manifest.json';
import { overlayOpeners } from './overlay-openers';

/**
 * [8.5.5] Route-level axe suite — BLOCKING. Scans every manifest route
 * (and every named overlay state, open) at the five-tag WCAG set, in
 * both locales. Suppressions only via `exceptions.ts`'s time-boxed
 * `a11yException` passed to `.disableRules()` — none are currently in
 * effect.
 */

const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];
const LOCALES = ['bn', 'en'] as const;

interface ManifestRoute {
  path: string;
  role: string;
  archetype: string;
  params?: Record<string, string>;
  overlays?: string[];
}

const routes = (manifest as { routes: ManifestRoute[] }).routes;

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

/** Resolves `$param` segments by seeding real records over the API. */
async function resolvePath(request: APIRequestContext, route: ManifestRoute): Promise<string> {
  if (!route.path.includes('$')) return route.path;
  const session: ApiSession = await adminApiSession(request);
  const stamp = Date.now();
  if (route.path.includes('$studentId')) {
    const { studentId } = await createStudentWithDues(request, session, `A11y Student ${stamp}`);
    return route.path.replace('$studentId', studentId);
  }
  if (route.path.includes('$guardianId')) {
    const guardian = await createGuardian(request, session, `A11y Guardian ${stamp}`);
    return route.path.replace('$guardianId', guardian.id);
  }
  if (route.path.includes('$invoiceId')) {
    const { studentId } = await createStudentWithDues(request, session, `A11y Invoicee ${stamp}`);
    const invoice = await createInvoice(request, session, studentId);
    return route.path.replace('$invoiceId', invoice.id);
  }
  if (route.path.includes('$academicYearId') || route.path.includes('$classId')) {
    const chain = await createClassSection(request, session);
    return route.path
      .replace('$academicYearId', chain.academicYearId)
      .replace('$classId', chain.classId);
  }
  throw new Error(`no resolver for ${route.path}`);
}

async function ensureDuesRow(request: APIRequestContext): Promise<void> {
  const session = await adminApiSession(request);
  await createStudentWithDues(request, session, `A11y Dues ${Date.now()}`);
}

for (const locale of LOCALES) {
  test.describe(`a11y · ${locale}`, () => {
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
          const path = await resolvePath(request, route);
          await page.goto(path);
          await expect(page.getByRole('heading', { level: 1 }).first()).toBeVisible();
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

import type { Page } from '@playwright/test';

import { expect, guest, loggedIn, test } from '../fixtures/test';
import type { SeedRole } from '../seed-contract';
import { resolvePath, routes } from './routes';

/**
 * [8.5.6] WCAG 2.2 SC 2.5.8 target size (minimum): every visible
 * interactive target ≥ 24×24 CSS px, exempting inline links inside text
 * blocks — the SC's own exception ("the target is in a sentence, or its
 * size is otherwise constrained by the line-height of non-target text").
 *
 * [8.13.8] adds a second, stricter pass for the guardian surface. SC 2.5.8's
 * 24px is the floor for the whole app; SC 2.5.5 (target size, ENHANCED) asks
 * for 44px, and the design contract §6 makes that the standard on `/portal`,
 * where the user is a parent on a 360px Android phone rather than a staff
 * member scanning a dense table on a desktop. The two assertions are
 * deliberately separate rather than one parameterised threshold: the 24px
 * gate must keep covering every route in the manifest even if the portal
 * pass is ever quarantined.
 */

const SELECTOR =
  'a, button, [role="button"], [role="menuitem"], input, textarea, select, [tabindex]:not([tabindex="-1"])';

/**
 * Measures every visible interactive target on the current page and returns
 * the ones smaller than `minimum` CSS px, as readable `tag[label] WxH`
 * strings. Shared by both passes so the two thresholds cannot drift apart in
 * what they count as a target or how they measure hit-area extensions.
 */
async function undersizedTargets(page: Page, minimum: number): Promise<string[]> {
  return page.evaluate(
    ({ selector, min }) => {
      function isInlineTextLink(el: Element): boolean {
        // SC 2.5.8 exception: a link that flows inside a sentence.
        if (el.tagName !== 'A') return false;
        if (getComputedStyle(el).display !== 'inline') return false;
        const parent = el.parentElement;
        if (!parent) return false;
        return Array.from(parent.childNodes).some(
          (n) => n.nodeType === Node.TEXT_NODE && (n.textContent ?? '').trim() !== '',
        );
      }
      const out: string[] = [];
      document.querySelectorAll(selector).forEach((el) => {
        const rect = el.getBoundingClientRect();
        const style = getComputedStyle(el);
        if (style.visibility === 'hidden' || style.display === 'none') return;
        if (rect.width === 0 || rect.height === 0) return; // not rendered
        // Visually-hidden elements (sr-only clip pattern: skip links,
        // Radix's hidden native <select>) are not pointer targets.
        if (rect.width <= 1 && rect.height <= 1) return;
        if (el.getAttribute('aria-hidden') === 'true') return;
        if (isInlineTextLink(el)) return;
        // A negative-inset ::after is the standard hit-area-extension
        // pattern (e.g. primitives/radio-group) — the pseudo-element
        // receives clicks, so it counts toward the target size.
        const after = getComputedStyle(el, '::after');
        let width = rect.width;
        let height = rect.height;
        if (after.position === 'absolute' && after.content !== 'none') {
          const grow = (v: string) => Math.max(0, -Number.parseFloat(v) || 0);
          width += grow(after.left) + grow(after.right);
          height += grow(after.top) + grow(after.bottom);
        }
        if (width < min || height < min) {
          const label = el.getAttribute('aria-label') ?? (el.textContent ?? '').trim().slice(0, 40);
          out.push(
            `${el.tagName.toLowerCase()}[${label}] ${Math.round(width)}x${Math.round(height)}`,
          );
        }
      });
      return out;
    },
    { selector: SELECTOR, min: minimum },
  );
}

for (const route of routes) {
  test.describe(route.path, () => {
    if (route.role === 'guest') test.use(guest);
    else if (route.path === '/select-school')
      test.use(loggedIn(route.role as SeedRole, { tenant: 'none' }));
    else test.use(loggedIn(route.role as SeedRole));

    test('all interactive targets are at least 24x24 CSS px', async ({ page, request }) => {
      const path = await resolvePath(request, route);
      await page.goto(path);
      await expect(page.getByRole('heading', { level: 1 }).first()).toBeVisible();

      const undersized = await undersizedTargets(page, 24);

      expect(undersized, `targets under 24x24:\n${undersized.join('\n')}`).toEqual([]);
    });
  });
}

/**
 * [8.13.8] The guardian surface at 44px (WCAG 2.2 SC 2.5.5, design contract
 * §6). Scoped to `/portal` and the auth screens — the routes that render
 * under `data-density="comfortable"` — because the whole point of two
 * density modes is that staff routes stay dense.
 *
 * 360x640 is not an arbitrary small viewport: it is the mid-range Android
 * profile `lighthouserc.cjs` already budgets against, i.e. the phone the
 * ticket is actually about. Asserting at the widest breakpoint would let a
 * control that reflows to something smaller on a phone pass.
 *
 * `/select-school` is here rather than in a "logged out" group because it is
 * reached with a session but no tenant, hence the `{ tenant: 'none' }`
 * fixture — the same shape the 24px loop above uses for it.
 */
const COMFORTABLE_ROUTES = [
  { path: '/login', auth: guest },
  { path: '/select-school', auth: loggedIn('admin', { tenant: 'none' }) },
  { path: '/portal', auth: loggedIn('parent') },
  { path: '/portal/fees', auth: loggedIn('parent') },
] as const;

for (const route of COMFORTABLE_ROUTES) {
  test.describe(`${route.path} (comfortable density)`, () => {
    test.use({ ...route.auth, viewport: { width: 360, height: 640 } });

    test('all interactive targets are at least 44x44 CSS px', async ({ page }) => {
      await page.goto(route.path);
      await expect(page.getByRole('heading', { level: 1 }).first()).toBeVisible();

      // Proves the mechanism, not just the outcome: if the `data-density`
      // attribute were dropped from the shell, every control would fall back
      // to its compact height and the assertion below would report a wall of
      // 32px buttons without ever saying why.
      await expect(page.locator('[data-density="comfortable"]').first()).toBeAttached();

      const undersized = await undersizedTargets(page, 44);

      expect(undersized, `targets under 44x44 on ${route.path}:\n${undersized.join('\n')}`).toEqual(
        [],
      );
    });
  });
}

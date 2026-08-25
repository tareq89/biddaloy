import { expect, guest, loggedIn, test } from '../fixtures/test';
import type { SeedRole } from '../seed-contract';
import { resolvePath, routes } from './routes';

/**
 * [8.5.6] WCAG 2.2 SC 2.5.8 target size (minimum): every visible
 * interactive target ≥ 24×24 CSS px, exempting inline links inside text
 * blocks — the SC's own exception ("the target is in a sentence, or its
 * size is otherwise constrained by the line-height of non-target text").
 */

const SELECTOR =
  'a, button, [role="button"], [role="menuitem"], input, textarea, select, [tabindex]:not([tabindex="-1"])';

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

      const undersized = await page.evaluate((selector) => {
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
          if (width < 24 || height < 24) {
            const label =
              el.getAttribute('aria-label') ?? (el.textContent ?? '').trim().slice(0, 40);
            out.push(
              `${el.tagName.toLowerCase()}[${label}] ${Math.round(width)}x${Math.round(height)}`,
            );
          }
        });
        return out;
      }, SELECTOR);

      expect(undersized, `targets under 24x24:\n${undersized.join('\n')}`).toEqual([]);
    });
  });
}

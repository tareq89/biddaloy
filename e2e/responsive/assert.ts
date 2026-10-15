import type { APIRequestContext, Page } from '@playwright/test';

import { expect } from '../fixtures/test';
import { expectNoHorizontalScroll, expectNoInnerHorizontalScroll } from '../pages/assertions';
import { resolvePath, type ManifestRoute } from './routes';

/**
 * Most routes render their own `<h1>`. A `redirect` archetype route may
 * land somewhere that opens a modal by default instead (e.g.
 * `/fees` → `/fees/dues`, or a redirect that auto-opens a modal to
 * preserve a deep link) — Radix's `Dialog` correctly
 * `aria-hide`s the rest of the page while open, so the underlying page's
 * `<h1>` is legitimately absent from the accessibility tree in that case.
 * The dialog's own title (required by Radix's a11y contract on every
 * `DialogContent`) is the equivalent "the page rendered something
 * meaningful" signal for that case.
 */
export function pageOrDialogHeading(page: Page, route: ManifestRoute) {
  const heading = page.getByRole('heading', { level: 1 }).first();
  if (route.archetype !== 'redirect') return heading;
  return heading.or(page.getByRole('dialog').first());
}

/**
 * [8.5.6] WCAG 1.4.10 reflow at a given viewport width: no page-level or
 * `DataTable` inner horizontal scroll. Extracted out of
 * `reflow.spec.ts` in [18.1.2] so `e2e/smoke/routes.smoke.spec.ts` can run
 * the same check on every PR without depending on the sweep-only spec.
 */
export async function expectNoHorizontalScrollAtWidth(
  page: Page,
  request: APIRequestContext,
  route: ManifestRoute,
  width: number,
): Promise<void> {
  await page.setViewportSize({ width, height: 900 });
  const path = await resolvePath(request, route);
  await page.goto(path);
  // A loader-gated route (e.g. /fees/dues) shows RoutePending, no h1, until its data lands.
  await expect(pageOrDialogHeading(page, route)).toBeVisible({ timeout: 15_000 });
  await expectNoHorizontalScroll(page);
  // [8.14.7] `DataTable`'s card mode exists precisely so a 320/640px page
  // no longer needs its own inner scroll region.
  await expectNoInnerHorizontalScroll(page);
}

/** Render smoke at a given viewport width — proves the route renders at
 * that width without asserting anything about scroll behavior. */
export async function expectRendersAtWidth(
  page: Page,
  request: APIRequestContext,
  route: ManifestRoute,
  width: number,
): Promise<void> {
  await page.setViewportSize({ width, height: 900 });
  const path = await resolvePath(request, route);
  await page.goto(path);
  await expect(pageOrDialogHeading(page, route)).toBeVisible();
}

/** [8.10.7.6.05] Moved here from `target-size.spec.ts` so other specs can reuse it. */
const SELECTOR =
  'a, button, [role="button"], [role="menuitem"], input, textarea, select, [tabindex]:not([tabindex="-1"])';

/**
 * Measures every visible interactive target on the current page and returns
 * the ones smaller than `minimum` CSS px, as readable `tag[label] WxH`
 * strings. Shared by both passes so the two thresholds cannot drift apart in
 * what they count as a target or how they measure hit-area extensions.
 */
export async function undersizedTargets(page: Page, minimum: number): Promise<string[]> {
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
      /**
       * A negative-inset pseudo-element is the standard hit-area-extension
       * pattern (e.g. primitives/radio-group, primitives/tabs' trigger) —
       * the pseudo-element receives clicks, so it counts toward the target
       * size. But a negative offset alone doesn't prove that: a *decorative*
       * pseudo-element can declare one too (e.g. tabs' active-tab underline
       * sits `bottom-[-5px]` with its own `h-0.5`, floating 3px clear of the
       * trigger's real edge) without covering the gap in between. Growth
       * only counts when the pseudo's own computed geometry is genuinely
       * contiguous with the element's edge on that side — either the box is
       * inset-stretched (both opposing offsets set, so it fills the gap by
       * construction, same as radio-group/checkbox) or its explicit size on
       * that axis exactly reaches the offset with no float left over.
       */
      function pseudoGrowth(el: Element, pseudo: string) {
        const s = getComputedStyle(el, pseudo);
        const zero = { near: 0, far: 0 };
        if (s.position !== 'absolute' || s.content === 'none') return { x: zero, y: zero };
        const num = (v: string) => (v === 'auto' ? null : Number.parseFloat(v));
        const axisGrowth = (near: number | null, far: number | null, size: number | null) => {
          const stretched = near !== null && far !== null;
          const out = { near: 0, far: 0 };
          if (near !== null && near < 0) {
            const claim = -near;
            const gap = stretched ? 0 : claim - (size ?? 0);
            if (gap <= 0.5) out.near = claim;
          }
          if (far !== null && far < 0) {
            const claim = -far;
            const gap = stretched ? 0 : claim - (size ?? 0);
            if (gap <= 0.5) out.far = claim;
          }
          return out;
        };
        return {
          x: axisGrowth(num(s.left), num(s.right), num(s.width)),
          y: axisGrowth(num(s.top), num(s.bottom), num(s.height)),
        };
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
        // Two pseudo slots can both be in play on one element — e.g. tabs'
        // trigger uses `after:` for the visible underline and `before:` for
        // the invisible hit-area extension. Take the max per side rather
        // than summing, since an overlapping claim from both isn't extra
        // reach.
        const before = pseudoGrowth(el, '::before');
        const after = pseudoGrowth(el, '::after');
        const width =
          rect.width + Math.max(before.x.near, after.x.near) + Math.max(before.x.far, after.x.far);
        const height =
          rect.height + Math.max(before.y.near, after.y.near) + Math.max(before.y.far, after.y.far);
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

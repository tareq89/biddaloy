/**
 * [Epic 42] Overlays drawn over the app for guide media. Each lives in a
 * shadow root with `pointer-events: none`, so the app under it is unaffected.
 */
import type { Locator, Page } from '@playwright/test';

export const BRAND = '#d9480f';

/**
 * Runs in the page before any app code (serialised: keep it self-contained).
 * Every pointerdown shows an expanding ring. On a mouse device a dot also
 * follows the pointer; on a touch device there is no cursor (D6).
 */
function pointerOverlay(opts: { touch: boolean; colour: string }): void {
  const install = () => {
    const host = document.createElement('div');
    host.setAttribute('data-guide-overlay', 'pointer');
    host.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:2147483647';
    const root = host.attachShadow({ mode: 'open' });
    const style = document.createElement('style');
    style.textContent = `
      .dot{position:fixed;width:22px;height:22px;margin:-11px 0 0 -11px;border-radius:50%;
        background:${opts.colour}59;border:2px solid ${opts.colour};left:-100px;top:-100px;
        transition:left .25s ease,top .25s ease}
      .ring{position:fixed;width:0;height:0;border-radius:50%;border:3px solid ${opts.colour};
        transform:translate(-50%,-50%);transition:width .45s ease-out,height .45s ease-out,opacity .45s ease-out}`;
    root.appendChild(style);
    const dot = document.createElement('div');
    dot.className = 'dot';
    if (!opts.touch) root.appendChild(dot);
    const move = (e: PointerEvent) => {
      dot.style.left = `${e.clientX}px`;
      dot.style.top = `${e.clientY}px`;
    };
    document.addEventListener('pointermove', move, true);
    document.addEventListener(
      'pointerdown',
      (e) => {
        move(e);
        const ring = document.createElement('div');
        ring.className = 'ring';
        ring.style.left = `${e.clientX}px`;
        ring.style.top = `${e.clientY}px`;
        root.appendChild(ring);
        requestAnimationFrame(() => {
          ring.style.width = ring.style.height = '56px';
          ring.style.opacity = '0';
        });
        setTimeout(() => ring.remove(), 600);
      },
      true,
    );
    document.documentElement.appendChild(host);
  };
  if (document.documentElement) install();
  else document.addEventListener('DOMContentLoaded', install);
}

export async function installPointer(page: Page, touch: boolean): Promise<void> {
  await page.addInitScript(pointerOverlay, { touch, colour: BRAND });
}

/**
 * Numbered badge plus outline ring over each locator, in order. Scrolls to the
 * first, then measures all at that scroll position. Remove with `clearCallouts`.
 */
export async function callouts(page: Page, targets: Locator[], label = 'callouts'): Promise<void> {
  // Smooth scrolling is still moving when scrollIntoViewIfNeeded resolves; measuring
  // then drew the boxes one element too high on the phone.
  await targets[0]?.scrollIntoViewIfNeeded();
  await page.waitForTimeout(400);
  const boxes = [];
  for (const t of targets) {
    const box = await t.boundingBox();
    if (!box) throw new Error(`callout target not visible for ${label}`);
    boxes.push(box);
  }
  await page.evaluate(
    ({ boxes, colour }) => {
      const host = document.createElement('div');
      host.setAttribute('data-guide-overlay', 'callouts');
      host.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:2147483646';
      const root = host.attachShadow({ mode: 'open' });
      boxes.forEach((b, i) => {
        const ring = document.createElement('div');
        ring.style.cssText = `position:fixed;left:${b.x - 4}px;top:${b.y - 4}px;width:${b.width + 8}px;height:${b.height + 8}px;border:3px solid ${colour};border-radius:8px`;
        const badge = document.createElement('div');
        badge.textContent = String(i + 1);
        badge.style.cssText = `position:fixed;left:${Math.max(2, b.x - 16)}px;top:${Math.max(2, b.y - 16)}px;width:28px;height:28px;border-radius:50%;background:${colour};color:#fff;font:bold 15px/28px system-ui,sans-serif;text-align:center;box-shadow:0 1px 3px rgba(0,0,0,.35)`;
        root.append(ring, badge);
      });
      document.body.appendChild(host);
    },
    { boxes, colour: BRAND },
  );
}

export async function clearCallouts(page: Page): Promise<void> {
  await page.evaluate(() =>
    document.querySelectorAll('[data-guide-overlay="callouts"]').forEach((n) => n.remove()),
  );
}

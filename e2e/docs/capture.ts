/**
 * [Epic 42] Capture toolkit for user-guide tours (`e2e/docs/tours/*.tour.ts`).
 *
 * - `guideLang()` / `imgDir()`: where a tour writes, per `GUIDE_LANG` (D27 paths).
 * - `prepare()`: light mode, the chosen language, the demo ribbon hidden, and a
 *   visible pointer with a tap ripple so GIFs show what was pressed (D6).
 * - `shoot()`: a screenshot with numbered callouts drawn on the parts the page
 *   text explains ("1 · Date", "2 · All present", ...).
 * - `recordGif()`: runs one workflow in a recording context and turns the video
 *   into a GIF with ffmpeg (≤ 960 px wide, 8 fps, 96 colours: keeps a 15 s GIF under 2 MB).
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, rmSync } from 'node:fs';
import path from 'node:path';

import type { Browser, BrowserContextOptions, Locator, Page } from '@playwright/test';

import bnDemo from '../../ui/src/i18n/locales/bn/demo.json';
import enDemo from '../../ui/src/i18n/locales/en/demo.json';

export type GuideLang = 'bn' | 'en';

export function guideLang(): GuideLang {
  return process.env.GUIDE_LANG === 'en' ? 'en' : 'bn';
}

/** `docs/user-guide/<lang>/<section>/img`, created on first use. */
export function imgDir(section: string): string {
  const dir = path.join('docs', 'user-guide', guideLang(), section, 'img');
  mkdirSync(dir, { recursive: true });
  return dir;
}

const CALLOUT_COLOUR = '#d9480f';

/** Runs in the page before any app code. Kept self-contained: it is serialised. */
function pointerOverlay(): void {
  const install = () => {
    const dot = document.createElement('div');
    dot.setAttribute('data-guide-overlay', 'pointer');
    Object.assign(dot.style, {
      position: 'fixed',
      width: '22px',
      height: '22px',
      marginLeft: '-11px',
      marginTop: '-11px',
      borderRadius: '50%',
      background: 'rgba(217,72,15,0.35)',
      border: '2px solid #d9480f',
      pointerEvents: 'none',
      zIndex: '2147483647',
      left: '-100px',
      top: '-100px',
      transition: 'left 0.25s ease, top 0.25s ease',
    });
    document.body.appendChild(dot);
    const move = (e: PointerEvent) => {
      dot.style.left = `${e.clientX}px`;
      dot.style.top = `${e.clientY}px`;
    };
    document.addEventListener('pointermove', move, true);
    document.addEventListener(
      'pointerdown',
      (e) => {
        move(e);
        const ripple = document.createElement('div');
        Object.assign(ripple.style, {
          position: 'fixed',
          left: `${e.clientX}px`,
          top: `${e.clientY}px`,
          width: '0',
          height: '0',
          borderRadius: '50%',
          border: '3px solid #d9480f',
          pointerEvents: 'none',
          zIndex: '2147483647',
          transform: 'translate(-50%, -50%)',
          transition: 'width 0.45s ease-out, height 0.45s ease-out, opacity 0.45s ease-out',
        });
        document.body.appendChild(ripple);
        requestAnimationFrame(() => {
          ripple.style.width = '56px';
          ripple.style.height = '56px';
          ripple.style.opacity = '0';
        });
        setTimeout(() => ripple.remove(), 600);
      },
      true,
    );
  };
  if (document.body) install();
  else document.addEventListener('DOMContentLoaded', install);
}

/** Language, light mode, no demo ribbon, visible pointer. Call before the first `goto`. */
export async function prepare(page: Page, opts: { pointer?: boolean } = {}): Promise<void> {
  const lang = guideLang();
  await page.addInitScript((locale) => {
    window.localStorage.setItem('biddaloy:locale', locale);
  }, lang);
  if (opts.pointer) await page.addInitScript(pointerOverlay);
  // The ribbon says "demo site"; a school's own app never shows it.
  const labels = [bnDemo.ribbonLabel, enDemo.ribbonLabel].map((l) => JSON.stringify(l));
  const css =
    labels.map((l) => `[role="note"][aria-label=${l}]`).join(',') + '{display:none!important}';
  await page.addInitScript((rule) => {
    const add = () => {
      const style = document.createElement('style');
      style.textContent = rule;
      document.head.appendChild(style);
    };
    if (document.head) add();
    else document.addEventListener('DOMContentLoaded', add);
  }, css);
}

export interface Callout {
  target: Locator;
  /** Shown only in the page's numbered list; the image carries the number. */
  note?: string;
}

/**
 * Screenshot of the viewport with a numbered badge and an outline on each
 * target, in order. Targets must be visible. The overlay is removed after.
 */
export async function shoot(
  page: Page,
  file: string,
  callouts: Callout[] = [],
  opts: { keepToasts?: boolean } = {},
): Promise<void> {
  // A leftover "saved" toast would cover the part the shot is about.
  if (!opts.keepToasts) {
    await page.evaluate(() =>
      document
        .querySelectorAll<HTMLElement>('[data-sonner-toaster]')
        .forEach((n) => (n.style.display = 'none')),
    );
  }
  // Scroll once, then measure every target at that same scroll position.
  await callouts[0]?.target.scrollIntoViewIfNeeded();
  const boxes = [];
  for (const c of callouts) {
    const box = await c.target.boundingBox();
    if (!box) throw new Error(`callout target not visible for ${file}`);
    boxes.push(box);
  }
  await page.evaluate(
    ({ boxes, colour }) => {
      const layer = document.createElement('div');
      layer.setAttribute('data-guide-overlay', 'callouts');
      Object.assign(layer.style, {
        position: 'fixed',
        inset: '0',
        pointerEvents: 'none',
        zIndex: '2147483646',
      });
      boxes.forEach((b, i) => {
        const outline = document.createElement('div');
        Object.assign(outline.style, {
          position: 'fixed',
          left: `${b.x - 4}px`,
          top: `${b.y - 4}px`,
          width: `${b.width + 8}px`,
          height: `${b.height + 8}px`,
          border: `3px solid ${colour}`,
          borderRadius: '8px',
        });
        const badge = document.createElement('div');
        badge.textContent = String(i + 1);
        Object.assign(badge.style, {
          position: 'fixed',
          left: `${Math.max(2, b.x - 16)}px`,
          top: `${Math.max(2, b.y - 16)}px`,
          width: '28px',
          height: '28px',
          borderRadius: '50%',
          background: colour,
          color: '#fff',
          font: 'bold 15px/28px system-ui, sans-serif',
          textAlign: 'center',
          boxShadow: '0 1px 3px rgba(0,0,0,.35)',
        });
        layer.append(outline, badge);
      });
      document.body.appendChild(layer);
    },
    { boxes, colour: CALLOUT_COLOUR },
  );
  // Let toasts and focus rings settle so the shot matches what a reader sees.
  await page.waitForTimeout(250);
  await page.screenshot({ path: file, animations: 'disabled', caret: 'hide' });
  await page.evaluate(() => {
    document.querySelectorAll('[data-guide-overlay="callouts"]').forEach((n) => n.remove());
    document
      .querySelectorAll<HTMLElement>('[data-sonner-toaster]')
      .forEach((n) => (n.style.display = ''));
  });
}

/** A short pause so a GIF viewer can follow each step. */
export const beat = (page: Page, ms = 700) => page.waitForTimeout(ms);

/**
 * Runs `workflow` in a fresh recording context (same sign-in as `storageState`)
 * and writes `<file>.gif`. The first `trimStartSec` seconds (page load) are cut.
 */
export async function recordGif(
  browser: Browser,
  contextOptions: BrowserContextOptions,
  file: string,
  workflow: (page: Page) => Promise<void>,
  opts: { trimStartSec?: number; width?: number } = {},
): Promise<void> {
  const viewport = contextOptions.viewport ?? { width: 1440, height: 900 };
  const videoDir = path.join('test-results', 'guide', 'video', path.basename(file, '.gif'));
  rmSync(videoDir, { recursive: true, force: true });
  const context = await browser.newContext({
    ...contextOptions,
    recordVideo: { dir: videoDir, size: viewport },
  });
  const page = await context.newPage();
  await prepare(page, { pointer: true });
  await workflow(page);
  await beat(page, 1200);
  const video = page.video();
  await context.close();
  const webm = await video!.path();
  const width = Math.min(opts.width ?? 960, viewport.width);
  const trim = String(opts.trimStartSec ?? 0);
  const filters = `fps=8,scale=${width}:-1:flags=lanczos,split[a][b];[a]palettegen=max_colors=96:stats_mode=diff[p];[b][p]paletteuse=dither=none:diff_mode=rectangle`;
  execFileSync('ffmpeg', [
    '-y',
    '-loglevel',
    'error',
    '-ss',
    trim,
    '-i',
    webm,
    '-vf',
    filters,
    '-loop',
    '0',
    file,
  ]);
}

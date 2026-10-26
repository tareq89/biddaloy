/**
 * [Epic 42 / W11] One GIF per tour file: sign in once as a demo card, then run
 * the workflow in a recording context (`recordGif`). A failure inside the
 * workflow leaves a screenshot in `GUIDE_FAIL_DIR` (default test-results/guide).
 */
import { mkdirSync } from 'node:fs';
import path from 'node:path';

import { devices, test, type BrowserContextOptions, type Page } from '@playwright/test';

import { imgDir, loginAs, prepare, recordGif } from './capture';

export interface GifTourOptions {
  /** Demo login card; none for a signed-out visitor (the public admission form). */
  card?: string;
  /** `<section>/img/<file>` under the language folder. */
  file: string;
  section?: string;
  phone?: boolean;
  trimStartSec?: number;
  /** GIF width in px (default 960; 390 on a phone). Smaller keeps a long workflow under 2 MB. */
  width?: number;
}

export function gifTour(
  title: string,
  opts: GifTourOptions,
  workflow: (page: Page) => Promise<void>,
): void {
  test(title, async ({ browser, page }, info) => {
    test.skip(info.project.metadata.device !== 'desktop');
    test.setTimeout(400_000);
    await prepare(page);
    if (opts.card) await loginAs(page, opts.card);
    const storageState = await page.context().storageState();
    const phone = devices['Pixel 7'];
    const context: BrowserContextOptions = opts.phone
      ? {
          storageState,
          viewport: { width: 390, height: 844 },
          userAgent: phone.userAgent,
          isMobile: true,
          hasTouch: true,
          deviceScaleFactor: 1,
        }
      : { storageState, viewport: { width: 1440, height: 900 } };
    const out = path.join(imgDir(opts.section ?? 'people'), opts.file);
    await recordGif(
      browser,
      context,
      out,
      async (p) => {
        p.setDefaultTimeout(15_000);
        try {
          await workflow(p);
        } catch (e) {
          const dir = process.env.GUIDE_FAIL_DIR ?? 'test-results/guide';
          mkdirSync(dir, { recursive: true });
          await p
            .screenshot({ path: path.join(dir, `fail-${opts.file}.png`) })
            .catch(() => undefined);
          throw e;
        }
      },
      { trimStartSec: opts.trimStartSec ?? 1, width: opts.width ?? (opts.phone ? 390 : 960) },
    );
  });
}

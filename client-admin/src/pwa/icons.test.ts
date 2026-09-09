/**
 * [15.8.1] Closes #358: `pwa-192.png` had been exported from a different,
 * offset crop of the source artwork than `pwa-512.png` — same file, wrong
 * glyph placement. `manifest.test.ts` only checks that the *declared*
 * sizes exist on disk, not that the pixels are actually that size or share
 * the same source, so this is the regression guard for both.
 */
import { resolve } from 'node:path';

import sharp from 'sharp';
import { describe, expect, it } from 'vitest';

const ICONS_DIR = resolve(import.meta.dirname, '../../public/icons');

describe('pwa icon artwork', () => {
  it('pwa-192.png is actually 192x192', async () => {
    const metadata = await sharp(resolve(ICONS_DIR, 'pwa-192.png')).metadata();
    expect(metadata.width).toBe(192);
    expect(metadata.height).toBe(192);
  });

  it('pwa-512.png is actually 512x512', async () => {
    const metadata = await sharp(resolve(ICONS_DIR, 'pwa-512.png')).metadata();
    expect(metadata.width).toBe(512);
    expect(metadata.height).toBe(512);
  });

  it('pwa-192.png is the same glyph as pwa-512.png, downscaled, not an offset crop', async () => {
    // Downscale the known-good 512 source to 192 and compare the decoded
    // pixels against the shipped 192 icon. Channel-mean comparison (the
    // original version of this test) can't catch a translated glyph — two
    // images with the same color coverage but shifted content still have
    // matching means. An offset/cropped export (the #358 bug) shows very
    // different pixels at the same coordinates than a clean downscale of
    // the same artwork.
    const shipped = await sharp(resolve(ICONS_DIR, 'pwa-192.png')).ensureAlpha().raw().toBuffer();
    const resized = await sharp(resolve(ICONS_DIR, 'pwa-512.png'))
      .resize(192, 192)
      .ensureAlpha()
      .raw()
      .toBuffer();

    expect(shipped.length).toBe(resized.length);

    let maxDiff = 0;
    for (let i = 0; i < shipped.length; i += 1) {
      maxDiff = Math.max(maxDiff, Math.abs(shipped[i] - resized[i]));
    }

    // Small tolerance for resize-algorithm/encoder rounding differences,
    // not for an offset crop — a mismatched glyph produces diffs near 255.
    expect(maxDiff).toBeLessThan(16);
  });
});

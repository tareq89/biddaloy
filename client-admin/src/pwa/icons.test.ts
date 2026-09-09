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
    // Downscale the known-good 512 source to 192 and compare mean channel
    // values against the shipped 192 icon. An offset/cropped export (the
    // #358 bug) shows very different brand-color coverage than a clean
    // downscale of the same artwork.
    const shipped = await sharp(resolve(ICONS_DIR, 'pwa-192.png')).stats();
    const resized = await sharp(resolve(ICONS_DIR, 'pwa-512.png')).resize(192, 192).stats();

    for (let channel = 0; channel < shipped.channels.length; channel += 1) {
      const shippedMean = shipped.channels[channel]?.mean ?? 0;
      const resizedMean = resized.channels[channel]?.mean ?? 0;
      expect(Math.abs(shippedMean - resizedMean)).toBeLessThan(5);
    }
  });
});

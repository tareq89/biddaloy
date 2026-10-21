import { describe, expect, it } from 'vitest';
import { testimonials, testimonialsNoindex } from './testimonials';
import { areas, SOON } from './features';

describe('content flags', () => {
  it('testimonials are hidden + noindex until three real ones exist (D13)', () => {
    expect(testimonialsNoindex()).toBe(true);
    expect(testimonialsNoindex(true, 2)).toBe(true);
    expect(testimonialsNoindex(true, 3)).toBe(false);
    for (const t of testimonials) expect(t.quote.bn.split(/\s+/).length).toBeLessThanOrEqual(40);
  });
  it('features: 15 areas, bn and en bullets align on the শীঘ্রই marker (D34)', () => {
    expect(areas).toHaveLength(15);
    for (const a of areas) {
      expect(a.en.bullets).toHaveLength(a.bn.bullets.length);
      a.bn.bullets.forEach((b, i) =>
        expect(a.en.bullets[i].startsWith(SOON)).toBe(b.startsWith(SOON)),
      );
    }
  });
});

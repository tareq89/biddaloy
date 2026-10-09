import { describe, expect, it, vi } from 'vitest';

import { fetchAsDataUrl } from './to-data-url';

describe('fetchAsDataUrl', () => {
  it('returns a data URL and de-duplicates concurrent calls', async () => {
    const fetcher = vi.fn().mockResolvedValue(new Blob(['hi'], { type: 'text/plain' }));
    const cache = new Map();
    const [a, b] = await Promise.all([
      fetchAsDataUrl('/a', fetcher, cache),
      fetchAsDataUrl('/a', fetcher, cache),
    ]);
    expect(a).toMatch(/^data:text\/plain;base64,/);
    expect(b).toBe(a);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
});

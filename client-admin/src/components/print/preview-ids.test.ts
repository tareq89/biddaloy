import { describe, expect, it } from 'vitest';

import { previewIdsNav, URL_IDS_MAX } from './preview-ids';

describe('previewIdsNav [2696]', () => {
  it('keeps a short list in the URL', () => {
    expect(previewIdsNav(['a', 'b'])).toEqual({ search: { ids: 'a,b' }, state: {} });
  });

  it('puts a 500-id list in history state, not the URL', () => {
    const ids = Array.from({ length: 500 }, (_, i) => `id-${i}`);
    const nav = previewIdsNav(ids);
    expect(nav.search.ids).toBeUndefined();
    expect(nav.state.printIds).toHaveLength(500);
    expect(previewIdsNav(ids.slice(0, URL_IDS_MAX)).search.ids).toBeDefined();
  });
});

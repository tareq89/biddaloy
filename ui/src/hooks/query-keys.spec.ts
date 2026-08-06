import { describe, expect, it } from 'vitest';

import { createEntityKeys } from './query-keys';

describe('createEntityKeys', () => {
  const keys = createEntityKeys<{ page?: number }>('widgets');

  it('builds the hierarchical shape every level nests under', () => {
    expect(keys.all).toEqual(['widgets']);
    expect(keys.lists()).toEqual(['widgets', 'list']);
    expect(keys.list({ page: 2 })).toEqual(['widgets', 'list', { page: 2 }]);
    expect(keys.details()).toEqual(['widgets', 'detail']);
    expect(keys.detail('id-1')).toEqual(['widgets', 'detail', 'id-1']);
  });

  it('list() with no filters still starts with lists() — so invalidating lists() covers it', () => {
    const noFilters = keys.list();
    expect(noFilters.slice(0, 2)).toEqual(keys.lists());
  });

  it('every detail key starts with details(), every list key starts with lists() — the property invalidation relies on', () => {
    expect(keys.detail('x').slice(0, 2)).toEqual(keys.details());
    expect(keys.list({ page: 1 }).slice(0, 2)).toEqual(keys.lists());
  });
});

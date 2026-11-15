import { describe, expect, it } from 'vitest';

import { toGroupFilters } from './filter-bar';

describe('toGroupFilters [#4056]', () => {
  it('passes the chosen source section through', () => {
    expect(toGroupFilters({ section_id: 'sec-1' })).toEqual({ section_id: 'sec-1' });
  });

  it('leaves it out when none is chosen', () => {
    expect(toGroupFilters({ section_id: '' })).toEqual({});
  });
});

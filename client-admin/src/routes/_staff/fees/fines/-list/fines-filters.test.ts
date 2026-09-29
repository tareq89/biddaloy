import type { TFunction } from 'i18next';
import { describe, expect, it } from 'vitest';

import { buildFinesFilterFields } from './fines-filters';

describe('buildFinesFilterFields', () => {
  it('labels the fine-type filter "all fine types", not the origin filter\'s "all"', () => {
    // A key-echoing translator: the assertion is about WHICH key is used.
    const t = ((key: string) => key) as unknown as TFunction<'fines', undefined>;
    const tCommon = ((key: string) => key) as unknown as TFunction<'common', undefined>;

    const fields = buildFinesFilterFields(t, tCommon, {
      classes: [],
      sections: [],
      fineStructures: [],
      monthOptions: [],
    });

    const fineType = fields.find((field) => 'key' in field && field.key === 'fee_structure_id');
    expect(fineType).toMatchObject({ allLabel: 'filters.allFineTypes' });
  });
});

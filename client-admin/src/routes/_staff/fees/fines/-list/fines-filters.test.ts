import { REGION_BD_EN } from '@biddaloy/ui/i18n';
import type { TFunction } from 'i18next';
import { describe, expect, it } from 'vitest';

import { buildFinesFilterFields } from './fines-filters';

// A key-echoing translator: the assertions are about WHICH key is used.
const t = ((key: string) => key) as unknown as TFunction<'fines', undefined>;
const tCommon = ((key: string) => key) as unknown as TFunction<'common', undefined>;

function fieldsFor() {
  return buildFinesFilterFields(t, tCommon, {
    classes: [],
    sections: [],
    fineStructures: [],
    regionConfig: REGION_BD_EN,
  });
}

describe('buildFinesFilterFields', () => {
  it('labels the fine-type filter "all fine types", not the origin filter\'s "all"', () => {
    const fineType = fieldsFor().find((f) => 'key' in f && f.key === 'fee_structure_id');
    expect(fineType).toMatchObject({
      label: 'filters.fineTypeLabel',
      allLabel: 'filters.allFineTypes',
    });
  });

  it('shows month names, keeping the values 1…12', () => {
    const month = fieldsFor().find((f) => 'key' in f && f.key === 'month');
    const options = (month as unknown as { options: { value: string; label: string }[] }).options;
    expect(options).toHaveLength(12);
    expect(options[0]).toEqual({ value: '1', label: 'January' });
    expect(options[11]).toEqual({ value: '12', label: 'December' });
  });
});

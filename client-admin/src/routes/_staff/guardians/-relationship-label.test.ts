import type { TFunction } from 'i18next';
import { describe, expect, it } from 'vitest';

import { relationshipLabel } from './-relationship-label';

const t = ((key: string) => `T:${key}`) as unknown as TFunction;

describe('relationshipLabel', () => {
  it.each(['father', 'FATHER', ' Father '])('translates %j', (v) => {
    expect(relationshipLabel(v, t)).toBe('T:enums.relationship.father');
  });
  it.each(['', null, undefined, '   '])('shows a dash for %j', (v) => {
    expect(relationshipLabel(v, t)).toBe('—');
  });
  it('returns unknown free text unchanged', () => {
    expect(relationshipLabel('Step-father', t)).toBe('Step-father');
  });
});

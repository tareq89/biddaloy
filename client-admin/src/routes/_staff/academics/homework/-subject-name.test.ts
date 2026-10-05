import { describe, expect, it } from 'vitest';

import { subjectName } from './-subject-name';

describe('subjectName', () => {
  it('uses name_bn on a Bangla page', () => {
    expect(subjectName({ name_en: 'Math', name_bn: 'গণিত' }, 'bn')).toBe('গণিত');
  });
  it('falls back to name_en when name_bn is missing', () => {
    expect(subjectName({ name_en: 'Math', name_bn: null }, 'bn')).toBe('Math');
  });
  it('uses name_en on an English page', () => {
    expect(subjectName({ name_en: 'Math', name_bn: 'গণিত' }, 'en')).toBe('Math');
  });
  it('returns a dash for an unknown subject', () => {
    expect(subjectName(undefined, 'en')).toBe('—');
  });
});

import { describe, expect, it } from 'vitest';

import { subjectName } from './-subject-name';

describe('subjectName', () => {
  it('uses the Bangla name on a Bangla screen, falling back to English', () => {
    expect(subjectName({ name_en: 'Math', name_bn: 'গণিত' }, 'bn')).toBe('গণিত');
    expect(subjectName({ name_en: 'Math', name_bn: null }, 'bn')).toBe('Math');
    expect(subjectName({ name_en: 'Math', name_bn: 'গণিত' }, 'en')).toBe('Math');
  });

  it('is a dash, never an id, when the subject is missing', () => {
    expect(subjectName(undefined, 'en')).toBe('—');
  });
});

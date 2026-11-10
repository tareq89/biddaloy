import { describe, expect, it } from 'vitest';
import { previewBase } from './preview';

describe('previewBase', () => {
  it('is the nginx preview path for a theme preview', () => {
    expect(previewBase('primary')).toBe('/website/preview/primary');
  });
  it('is undefined on a school site, so its links stay as they are', () => {
    expect(previewBase(undefined)).toBeUndefined();
  });
});

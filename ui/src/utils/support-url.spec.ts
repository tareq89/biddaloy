import { describe, expect, it } from 'vitest';

import { isSafeSupportUrl } from './support-url';

describe('isSafeSupportUrl', () => {
  it('allows https and mailto', () => {
    expect(isSafeSupportUrl('https://example.com/help')).toBe(true);
    expect(isSafeSupportUrl('MAILTO:help@example.com')).toBe(true);
  });

  it('refuses everything else, and empty values', () => {
    for (const url of ['javascript:alert(1)', 'http://example.com', 'data:text/html,x', '/help']) {
      expect(isSafeSupportUrl(url)).toBe(false);
    }
    expect(isSafeSupportUrl('')).toBe(false);
    expect(isSafeSupportUrl(null)).toBe(false);
    expect(isSafeSupportUrl(undefined)).toBe(false);
  });
});

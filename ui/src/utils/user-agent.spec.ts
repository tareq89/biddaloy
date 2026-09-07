import { describe, expect, it } from 'vitest';

import { describeUserAgent } from './user-agent';

describe('describeUserAgent', () => {
  it('returns null for a missing user agent', () => {
    expect(describeUserAgent(null)).toBeNull();
    expect(describeUserAgent(undefined)).toBeNull();
    expect(describeUserAgent('')).toBeNull();
  });

  it('identifies Chrome on Windows', () => {
    const ua =
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36';
    expect(describeUserAgent(ua)).toEqual({ browser: 'Chrome', os: 'Windows' });
  });

  it('identifies Safari on iOS, not Chrome (CriOS check must not misfire)', () => {
    const ua =
      'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1';
    expect(describeUserAgent(ua)).toEqual({ browser: 'Safari', os: 'iOS' });
  });

  it('identifies Chrome on Android', () => {
    const ua =
      'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Mobile Safari/537.36';
    expect(describeUserAgent(ua)).toEqual({ browser: 'Chrome', os: 'Android' });
  });

  it('identifies Firefox on macOS', () => {
    const ua =
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:128.0) Gecko/20100101 Firefox/128.0';
    expect(describeUserAgent(ua)).toEqual({ browser: 'Firefox', os: 'macOS' });
  });

  it('identifies Edge on Windows, not Chrome (Edg/ check must win)', () => {
    const ua =
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36 Edg/128.0.0.0';
    expect(describeUserAgent(ua)).toEqual({ browser: 'Edge', os: 'Windows' });
  });

  it('returns null for a string that matches neither browser nor OS patterns', () => {
    expect(describeUserAgent('curl/8.4.0')).toBeNull();
  });

  it('falls back to "Unknown" for the half that could not be identified', () => {
    // A browser is identified but the OS token is something none of the
    // patterns recognize.
    expect(describeUserAgent('Chrome/128.0.0.0 on SomeExoticOS/1.0')).toEqual({
      browser: 'Chrome',
      os: 'Unknown',
    });
  });
});

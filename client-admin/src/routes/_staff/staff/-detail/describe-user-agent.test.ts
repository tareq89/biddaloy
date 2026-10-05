import { describe, expect, it } from 'vitest';

import { describeUserAgent } from './describe-user-agent';

const t = 'Unknown browser';

describe('describeUserAgent', () => {
  it.each([
    [
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36',
      'Chrome · Windows',
    ],
    [
      'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Version/17.0 Mobile/15E148 Safari/604.1',
      'Safari · iOS',
    ],
    ['Mozilla/5.0 (X11; Linux x86_64; rv:128.0) Gecko/20100101 Firefox/128.0', 'Firefox · Linux'],
    [
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126.0 Safari/537.36 Edg/126.0',
      'Edge · Windows',
    ],
    ['curl/8.0', 'Unknown browser'],
  ])('%s -> %s', (ua, expected) => {
    expect(describeUserAgent(ua, t)).toBe(expected);
  });

  it('returns a dash for null', () => {
    expect(describeUserAgent(null, t)).toBe('—');
  });
});

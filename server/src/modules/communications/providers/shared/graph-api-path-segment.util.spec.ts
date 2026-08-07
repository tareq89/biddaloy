import { describe, it, expect } from 'vitest';
import { isValidGraphApiId, isValidGraphApiVersion } from './graph-api-path-segment.util';

describe('isValidGraphApiId', () => {
  it('accepts a plain numeric id', () => {
    expect(isValidGraphApiId('123456789')).toBe(true);
  });

  it('rejects a path-traversal-shaped value', () => {
    expect(isValidGraphApiId('123/../evil')).toBe(false);
  });

  it('rejects a value pointing at another host', () => {
    expect(isValidGraphApiId('123?x=1&redirect=http://evil.example')).toBe(false);
  });

  it('rejects an empty string', () => {
    expect(isValidGraphApiId('')).toBe(false);
  });
});

describe('isValidGraphApiVersion', () => {
  it('accepts a real Graph API version', () => {
    expect(isValidGraphApiVersion('v21.0')).toBe(true);
  });

  it('rejects a version with an embedded path segment', () => {
    expect(isValidGraphApiVersion('v21.0/evil')).toBe(false);
  });

  it('rejects a version missing the leading v', () => {
    expect(isValidGraphApiVersion('21.0')).toBe(false);
  });
});

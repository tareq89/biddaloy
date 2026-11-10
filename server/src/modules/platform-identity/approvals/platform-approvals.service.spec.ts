import { describe, it, expect } from 'vitest';
import { hashPayload } from './platform-approvals.service';

describe('hashPayload', () => {
  const base = { method: 'post', path: '/p', body: { a: 1, b: { c: [1, 2], d: 'x' } } };

  it('ignores key order and method case', () => {
    const same = { method: 'POST', path: '/p', body: { b: { d: 'x', c: [1, 2] }, a: 1 } };
    expect(hashPayload(same)).toBe(hashPayload(base));
  });

  it('changes when the body, path or method changes', () => {
    expect(hashPayload({ ...base, body: { a: 2 } })).not.toBe(hashPayload(base));
    expect(hashPayload({ ...base, path: '/q' })).not.toBe(hashPayload(base));
    expect(hashPayload({ ...base, method: 'DELETE' })).not.toBe(hashPayload(base));
  });

  it('treats a missing body like null', () => {
    expect(hashPayload({ method: 'POST', path: '/p', body: undefined })).toBe(
      hashPayload({ method: 'POST', path: '/p', body: null }),
    );
  });
});

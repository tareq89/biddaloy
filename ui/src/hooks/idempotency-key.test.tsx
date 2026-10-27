import { renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { useIdempotencyKey } from './idempotency-key';

afterEach(() => {
  sessionStorage.clear();
  vi.restoreAllMocks();
});

describe('useIdempotencyKey [2594]', () => {
  it('keeps the key while the body is unchanged', () => {
    const { result } = renderHook(() => useIdempotencyKey());
    expect(result.current.keyFor({ a: 1 })).toBe(result.current.keyFor({ a: 1 }));
  });

  it('mints a new key when the body changes', () => {
    const { result } = renderHook(() => useIdempotencyKey());
    expect(result.current.keyFor({ a: 1 })).not.toBe(result.current.keyFor({ a: 2 }));
  });

  it('rotate() gives a new key for the same body', () => {
    const { result } = renderHook(() => useIdempotencyKey());
    const before = result.current.keyFor({ a: 1 });
    result.current.rotate();
    expect(result.current.keyFor({ a: 1 })).not.toBe(before);
  });
});

describe('useIdempotencyKey survives a reload [2951]', () => {
  it('a fresh mount returns the same key for the same body', () => {
    const first = renderHook(() => useIdempotencyKey());
    const key = first.result.current.keyFor({ a: 1 });
    first.unmount();
    const second = renderHook(() => useIdempotencyKey());
    expect(second.result.current.keyFor({ a: 1 })).toBe(key);
  });

  it('after rotate() a fresh mount gets a new key for the same body', () => {
    const first = renderHook(() => useIdempotencyKey());
    const key = first.result.current.keyFor({ a: 1 });
    first.result.current.rotate();
    first.unmount();
    const second = renderHook(() => useIdempotencyKey());
    expect(second.result.current.keyFor({ a: 1 })).not.toBe(key);
  });

  it('a fresh mount after the reload window gets a new key for the same body', () => {
    const now = vi.spyOn(Date, 'now').mockReturnValue(1_000_000);
    const first = renderHook(() => useIdempotencyKey());
    const key = first.result.current.keyFor({ a: 1 });
    first.unmount();
    now.mockReturnValue(1_000_000 + 31 * 60 * 1000);
    const second = renderHook(() => useIdempotencyKey());
    expect(second.result.current.keyFor({ a: 1 })).not.toBe(key);
  });

  it('does not store the body itself', () => {
    const { result } = renderHook(() => useIdempotencyKey());
    result.current.keyFor({ name: 'Rahima Begum' });
    expect(JSON.stringify({ ...sessionStorage })).not.toContain('Rahima');
  });

  it('blocked storage still gives a stable key within one mount', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    const { result } = renderHook(() => useIdempotencyKey());
    const key = result.current.keyFor({ a: 1 });
    expect(result.current.keyFor({ a: 1 })).toBe(key);
    expect(() => result.current.rotate()).not.toThrow();
  });
});

import { renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { useIdempotencyKey } from './idempotency-key';

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

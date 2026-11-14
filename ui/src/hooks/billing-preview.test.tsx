import { act, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { renderHookWithProviders } from '../test/render-hook-with-providers';

import { useOrderPreview } from './billing';

describe('useOrderPreview', () => {
  const run = (coupon_code?: string) => {
    const hook = renderHookWithProviders(() => useOrderPreview(), { tenantId: 'tenant-1' });
    act(() =>
      hook.result.current.mutate({ seats: 10, months: 2, ...(coupon_code ? { coupon_code } : {}) }),
    );
    return hook;
  };

  it('valid coupon takes the discount off', async () => {
    const { result } = run('HALF');
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toMatchObject({
      listAmountPaisa: 100000,
      discountPaisa: 50000,
      totalPaisa: 50000,
      free: false,
    });
  });

  it('free coupon gives a zero total', async () => {
    const { result } = run('FREE');
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toMatchObject({ totalPaisa: 0, free: true, status: 'PAID' });
  });

  it('invalid coupon surfaces as an error', async () => {
    const { result } = run('NOPE');
    await waitFor(() => expect(result.current.isError).toBe(true));
  });
});

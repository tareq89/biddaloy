import { waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { server } from '../test/msw/server';
import { errorHandler } from '../test/msw/support';
import { renderHookWithProviders } from '../test/render-hook-with-providers';
import { cleanupTestState } from '../test/render-with-providers';

import { downloadRevenueCsv, usePlatformRevenue } from './platform-money-revenue';
import * as reports from './reports';

afterEach(async () => {
  vi.restoreAllMocks();
  await cleanupTestState();
});

describe('platform revenue hooks', () => {
  it('loading, then the month with refunds netted and the not-renewed list', async () => {
    const { result } = renderHookWithProviders(() => usePlatformRevenue({ month: '2029-12' }));
    expect(result.current.isLoading).toBe(true);
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    const d = result.current.data!;
    expect(d.seat_income_paisa + d.package_income_paisa - d.refunds_paisa).toBe(1_050_000);
    expect(d.net_paisa).toBe(1_050_000);
    expect(d.not_renewed.items).toHaveLength(1);
  });

  it('a 500 surfaces as an error', async () => {
    server.use(errorHandler('get', '*/platform/money/revenue', 500));
    const { result } = renderHookWithProviders(() => usePlatformRevenue());
    await waitFor(() => expect(result.current.isError).toBe(true));
  });

  it('CSV: downloads the body under the month name', async () => {
    const save = vi.spyOn(reports, 'saveBlob').mockImplementation(() => undefined);
    await downloadRevenueCsv('2029-12');
    expect(save).toHaveBeenCalledTimes(1);
    expect(save.mock.calls[0]![1]).toBe('revenue-2029-12.csv');
    expect(await save.mock.calls[0]![0].text()).toContain('Rose Valley School');
  });
});

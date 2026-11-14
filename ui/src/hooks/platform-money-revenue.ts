import { keepPreviousData, useQuery } from '@tanstack/react-query';

import { cockpitRequest } from './cockpit-request';
import { downloadMoneyCsv, MONEY_PAGE_SIZE } from './platform-money-sms';
import { createEntityKeys } from './query-keys';
import { shouldRetryQuery } from './retry';

/** Mirrors `server/.../revenue/dto/revenue.dto.ts` (the schema leaves it untyped). Money is whole paisa. */
export interface NotRenewedRow {
  school_id: string;
  name: string;
  paid_until: string;
  days_since_ended: number;
  plan: string | null;
}
export interface PlatformRevenueReport {
  month: string;
  seat_income_paisa: number;
  package_income_paisa: number;
  /** Already netted out of `net_paisa`. */
  refunds_paisa: number;
  net_paisa: number;
  paying_schools: number;
  not_renewed: { items: NotRenewedRow[]; next_cursor: string | null };
}

export const platformRevenueKeys = createEntityKeys<{ month?: string; cursor?: string }>(
  'platform-money-revenue',
);

/** `GET /platform/money/revenue`. `month` is `YYYY-MM` (server default: this month). */
export function usePlatformRevenue(params: { month?: string; cursor?: string } = {}) {
  return useQuery({
    queryKey: platformRevenueKeys.list(params),
    queryFn: ({ signal }) =>
      cockpitRequest<PlatformRevenueReport>({
        url: '/platform/money/revenue',
        params: { month: params.month, cursor: params.cursor, limit: MONEY_PAGE_SIZE },
        signal,
      }),
    placeholderData: keepPreviousData,
    retry: shouldRetryQuery,
  });
}

/** `GET /platform/money/revenue?format=csv`. */
export const downloadRevenueCsv = (month?: string) =>
  downloadMoneyCsv(
    '/platform/money/revenue',
    month ? { month } : {},
    `revenue-${month ?? 'this-month'}.csv`,
  );

import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query';

import { useApprovedMutation } from './approval';
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

/** Mirrors `VatSettingDto`: one setting for all schools. `rate_percent` is null when VAT is off. */
export interface PlatformVatSetting {
  enabled: boolean;
  rate_percent: number | null;
  label: string;
  registration: string | null;
}
export interface UpdatePlatformVatInput {
  enabled: boolean;
  /** 0.01 to 50, two decimals; required when `enabled`. */
  rate_percent?: number;
  label?: string;
}

const vatKey = ['platform-money-vat'] as const;

/** `GET /platform/money/vat`. */
export function usePlatformVat(enabled = true) {
  return useQuery({
    queryKey: vatKey,
    queryFn: ({ signal }) =>
      cockpitRequest<PlatformVatSetting>({ url: '/platform/money/vat', signal }),
    enabled,
    retry: shouldRetryQuery,
  });
}

/** `PUT /platform/money/vat` behind a step-up code (`platform.vat`). */
export function useUpdatePlatformVat() {
  const qc = useQueryClient();
  return useApprovedMutation(
    (data: UpdatePlatformVatInput, { headers }) =>
      cockpitRequest<PlatformVatSetting>({
        method: 'PUT',
        url: '/platform/money/vat',
        data,
        headers,
      }),
    {
      approvalScope: 'platform.vat',
      onSuccess: () => qc.invalidateQueries({ queryKey: vatKey }),
    },
  );
}

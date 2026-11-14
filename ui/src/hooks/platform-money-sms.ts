import type { ActionLineDto, SmsProviderBalanceDto } from '@biddaloy/shared';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import type { components } from '../api/schema';

import { useApprovedMutation } from './approval';
import { cockpitRequest } from './cockpit-request';
import { useIdempotencyKey } from './idempotency-key';
import { createEntityKeys } from './query-keys';
import { saveBlob } from './reports';
import { shouldRetryQuery } from './retry';

type S = components['schemas'];
export type SmsPackage = S['SmsPackageDto'];
export type CreateSmsPackageInput = S['CreateSmsPackageDto'];
export type UpdateSmsPackageInput = S['UpdateSmsPackageDto'];
export type SmsStockEntry = S['SmsStockEntryDto'];
export type SmsStockPage = S['SmsStockPageDto'];
export type RecordSmsStockInput = S['RecordSmsStockDto'];
export type ProviderBalance = S['ProviderBalanceDto'];

/** Mirrors `server/.../report/dto/sms-state-report.dto.ts` (the OpenAPI schema leaves it untyped). */
export interface SmsStateTotals {
  boughtSms: number;
  soldSms: number;
  usedSms: number;
  expiredSms: number;
  promisedUnusedSms: number;
  unsoldSms: number;
  revenuePaisa: number;
  costPaisa: number;
  marginPaisa: number;
}
export interface SmsStatePackageRow {
  catalogId: string;
  name: string;
  orders: number;
  soldSms: number;
  revenuePaisa: number;
  costPaisa: number;
  marginPaisa: number;
}
export interface SmsStateSchoolRow {
  schoolId: string;
  schoolName: string;
  orders: number;
  soldSms: number;
  usedSms: number;
  expiredSms: number;
  revenuePaisa: number;
  costPaisa: number;
  marginPaisa: number;
  failedSms: number;
  sentSms: number;
  failureRateBp: number | null;
}
export interface SmsStateReport {
  actionLines: ActionLineDto[];
  balance: SmsProviderBalanceDto;
  totals: SmsStateTotals;
  packages: SmsStatePackageRow[];
  schools: SmsStateSchoolRow[];
  nextCursor: string | null;
}

export const platformMoneySmsKeys = createEntityKeys<{ after?: string | undefined }>(
  'platform-money-sms',
);
export const platformSmsPackageKeys = createEntityKeys('platform-sms-packages');
export const platformSmsStockKeys = createEntityKeys<{ cursor?: string | undefined }>(
  'platform-sms-stock',
);
export const platformSmsBalanceKeys = createEntityKeys('platform-sms-balance');

/** Rule 5: the server caps `limit` at 100. */
export const MONEY_PAGE_SIZE = 25;

/**
 * `GET /platform/money/sms`. No filter (D12); `after` is the report's own opaque cursor
 * (it pages the school rows, not `cursor`).
 */
export function usePlatformSmsReport(after?: string) {
  return useQuery({
    queryKey: platformMoneySmsKeys.list({ after }),
    queryFn: ({ signal }) =>
      cockpitRequest<SmsStateReport>({
        url: '/platform/money/sms',
        params: { limit: MONEY_PAGE_SIZE, after },
        signal,
      }),
    placeholderData: keepPreviousData,
    retry: shouldRetryQuery,
  });
}

/** `GET /platform/sms-packages` (all packages, on and off; no cursor, `limit` only). */
export function usePlatformSmsPackages() {
  return useQuery({
    queryKey: platformSmsPackageKeys.lists(),
    queryFn: ({ signal }) =>
      cockpitRequest<SmsPackage[]>({
        url: '/platform/sms-packages',
        params: { limit: 100 },
        signal,
      }),
    retry: shouldRetryQuery,
  });
}

function useInvalidatePackages() {
  const queryClient = useQueryClient();
  return () => {
    void queryClient.invalidateQueries({ queryKey: platformSmsPackageKeys.all });
    void queryClient.invalidateQueries({ queryKey: platformMoneySmsKeys.all });
  };
}

/** `POST /platform/sms-packages`. Step-up scope `platform.plan` (#3856). */
export function useCreateSmsPackage() {
  const invalidate = useInvalidatePackages();
  const { keyFor, rotate } = useIdempotencyKey();
  return useApprovedMutation(
    (input: CreateSmsPackageInput, { headers }) =>
      cockpitRequest<SmsPackage>({
        method: 'POST',
        url: '/platform/sms-packages',
        data: input,
        headers: { ...headers, 'Idempotency-Key': keyFor(input) },
      }),
    {
      approvalScope: 'platform.plan',
      onSuccess: () => {
        rotate();
        invalidate();
      },
    },
  );
}

/** `PATCH /platform/sms-packages/:id`. */
export function useUpdateSmsPackage() {
  const invalidate = useInvalidatePackages();
  return useApprovedMutation(
    ({ id, ...data }: UpdateSmsPackageInput & { id: string }, { headers }) =>
      cockpitRequest<SmsPackage>({
        method: 'PATCH',
        url: `/platform/sms-packages/${id}`,
        data,
        headers,
      }),
    { approvalScope: 'platform.plan', onSuccess: invalidate },
  );
}

/** `POST /platform/sms-packages/:id/active`: switch a package on or off (no step-up). */
export function useSetSmsPackageActive() {
  const invalidate = useInvalidatePackages();
  return useMutation({
    mutationFn: ({ id, active }: { id: string; active: boolean }) =>
      cockpitRequest<SmsPackage>({
        method: 'POST',
        url: `/platform/sms-packages/${id}/active`,
        data: { active },
      }),
    retry: false,
    onSuccess: invalidate,
  });
}

/** `GET /platform/sms-stock` (purchases, newest first, keyset). */
export function usePlatformSmsStock(cursor?: string) {
  return useQuery({
    queryKey: platformSmsStockKeys.list({ cursor }),
    queryFn: ({ signal }) =>
      cockpitRequest<SmsStockPage>({
        url: '/platform/sms-stock',
        params: { limit: MONEY_PAGE_SIZE, cursor },
        signal,
      }),
    placeholderData: keepPreviousData,
    retry: shouldRetryQuery,
  });
}

/** `GET /platform/sms-stock/balance`. */
export function usePlatformSmsBalance() {
  return useQuery({
    queryKey: platformSmsBalanceKeys.all,
    queryFn: ({ signal }) =>
      cockpitRequest<ProviderBalance>({ url: '/platform/sms-stock/balance', signal }),
    retry: shouldRetryQuery,
  });
}

function useInvalidateStock() {
  const queryClient = useQueryClient();
  return () => {
    void queryClient.invalidateQueries({ queryKey: platformSmsStockKeys.all });
    void queryClient.invalidateQueries({ queryKey: platformSmsBalanceKeys.all });
    void queryClient.invalidateQueries({ queryKey: platformMoneySmsKeys.all });
  };
}

/** `POST /platform/sms-stock`: record a purchase. One `Idempotency-Key` per attempt. */
export function useRecordSmsStock() {
  const invalidate = useInvalidateStock();
  const { keyFor, rotate } = useIdempotencyKey();
  return useMutation({
    mutationFn: (input: RecordSmsStockInput) =>
      cockpitRequest<SmsStockEntry>({
        method: 'POST',
        url: '/platform/sms-stock',
        data: input,
        headers: { 'Idempotency-Key': keyFor(input) },
      }),
    retry: false,
    onSuccess: () => {
      rotate();
      invalidate();
    },
  });
}

/** `POST /platform/sms-stock/balance`: type in the provider dashboard's balance. */
export function useRecordProviderBalance() {
  const invalidate = useInvalidateStock();
  return useMutation({
    mutationFn: (input: { smsBalance: number }) =>
      cockpitRequest<unknown>({ method: 'POST', url: '/platform/sms-stock/balance', data: input }),
    retry: false,
    onSuccess: invalidate,
  });
}

/** `DELETE /platform/sms-stock/:id` with a reason. Step-up scope `platform.sms_stock`. */
export function useDeleteSmsStock() {
  const invalidate = useInvalidateStock();
  return useApprovedMutation(
    ({ id, reason }: { id: string; reason: string }, { headers }) =>
      cockpitRequest({
        method: 'DELETE',
        url: `/platform/sms-stock/${id}`,
        data: { reason },
        headers,
      }),
    { approvalScope: 'platform.sms_stock', onSuccess: invalidate },
  );
}

/**
 * Download a money CSV (`/platform/money/sms?format=csv`, `/platform/money/revenue?format=csv`).
 * Goes through `cockpitRequest` so the owner's session token rides along; the file name comes
 * from the path's `format`/`month` (that helper hands back the body only, not the headers).
 */
export async function downloadMoneyCsv(
  path: string,
  params: Record<string, string> = {},
  filename = 'export.csv',
): Promise<void> {
  const data = await cockpitRequest<Blob | string>({
    url: path,
    params: { ...params, format: 'csv' },
    responseType: 'blob',
  });
  saveBlob(data instanceof Blob ? data : new Blob([data], { type: 'text/csv' }), filename);
}

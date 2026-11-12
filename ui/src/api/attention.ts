import type { AlertCategory, AlertItem, AttentionSummary } from '@biddaloy/shared';

import { apiClient } from './client';
import type { components, operations } from './schema';

/**
 * [67.2.01] Typed fetchers for the attention engine (`/attention/*`).
 * Plain functions, no React — hooks live in `hooks/attention/`.
 */

export type { AlertItem, AttentionSummary };
export type AlertItemsPage = components['schemas']['AlertItemsPageDto'];
export type StudentAlert = components['schemas']['StudentAlertDto'];
export type PlatformAttentionHealth = components['schemas']['PlatformAttentionHealthDto'];

export type AttentionLocale = 'bn' | 'en';
export type SnoozeChoice = components['schemas']['SnoozeDto']['choice'];

export interface AttentionItemsQuery {
  tab: 'active' | 'history';
  category?: AlertCategory;
  sectionId?: string;
  studentId?: string;
  page?: number;
  pageSize?: number;
  locale?: AttentionLocale;
}

/** Where the bar, worklist and item actions talk. School shells: `/attention` through `apiClient`
 * (tenant + role headers). The cockpit has no school, so it swaps in `/platform/attention` and a
 * plain request (see `hooks/attention/cockpit-source.ts`). Set once at load, never per render. */
export interface AttentionTransport {
  get<T>(url: string, config?: { params?: unknown; signal?: AbortSignal }): Promise<{ data: T }>;
  post<T>(url: string, body?: unknown): Promise<{ data: T }>;
}

const schoolHttp: AttentionTransport = {
  get: <T>(url: string, config?: { params?: unknown; signal?: AbortSignal }) =>
    apiClient.get<T>(url, config),
  post: <T>(url: string, body?: unknown) => apiClient.post<T>(url, body),
};
const schoolSource: { base: string; cockpit: boolean; http: AttentionTransport } = {
  base: '/attention',
  cockpit: false,
  http: schoolHttp,
};
let source = schoolSource;

export function setAttentionSource(next: {
  base: string;
  http: AttentionTransport;
  cockpit: boolean;
}): void {
  source = next;
}

/** Tests only: back to the school shells' source. */
export function resetAttentionSource(): void {
  source = schoolSource;
}

/** A GET that follows the active source: `apiClient` in a school shell, `cockpitRequest` on the cockpit. */
export const sourceGet = <T>(url: string, signal: AbortSignal): Promise<{ data: T }> =>
  source.http.get<T>(url, { signal });

export const isCockpitAttention = (): boolean => source.cockpit;

/** The server caps `POST /attention/items/seen` at 100 ids. */
export const ATTENTION_SEEN_MAX = 100;

export async function getAttentionSummary(
  params: { role: string; locale: AttentionLocale },
  signal: AbortSignal,
): Promise<AttentionSummary> {
  return (
    await source.http.get<AttentionSummary>(`${source.base}/summary`, {
      params: source.cockpit ? { locale: params.locale } : params,
      signal,
    })
  ).data;
}

export async function getAttentionItems(
  query: AttentionItemsQuery,
  signal: AbortSignal,
): Promise<AlertItemsPage> {
  return (await source.http.get<AlertItemsPage>(`${source.base}/items`, { params: query, signal }))
    .data;
}

export async function hideAttentionItem(recipientId: string): Promise<AlertItem> {
  return (await source.http.post<AlertItem>(`${source.base}/items/${recipientId}/hide`)).data;
}

export async function snoozeAttentionItem(
  recipientId: string,
  body: { choice: SnoozeChoice; date?: string },
): Promise<AlertItem> {
  return (await source.http.post<AlertItem>(`${source.base}/items/${recipientId}/snooze`, body))
    .data;
}

export async function markAttentionSeen(recipientIds: string[]): Promise<{ updated: number }> {
  return (
    await source.http.post<{ updated: number }>(`${source.base}/items/seen`, {
      recipientIds: recipientIds.slice(0, ATTENTION_SEEN_MAX),
    })
  ).data;
}

export async function getStudentAttention(
  studentId: string,
  locale: AttentionLocale,
  signal: AbortSignal,
): Promise<StudentAlert[]> {
  return (
    await apiClient.get<StudentAlert[]>(`/attention/students/${studentId}`, {
      params: { locale },
      signal,
    })
  ).data;
}

export async function getPlatformAttentionHealth(
  signal: AbortSignal,
): Promise<PlatformAttentionHealth> {
  // Always `apiClient`, never the cockpit source: `/platform/attention/health` still rejects a
  // cockpit token (401), and a 401 on the cockpit transport ends the owner's whole session. On the
  // cockpit host this fails fast (no active school) and the card shows its retry state instead.
  return (await apiClient.get<PlatformAttentionHealth>('/platform/attention/health', { signal }))
    .data;
}

// [67.5.07] Wave-5 types come straight from the regenerated schema.
export type ManualAudience = components['schemas']['ManualAudienceDto'];
export type CreateManualAlertInput = components['schemas']['CreateManualAlertDto'];
export type ManualAlert = components['schemas']['ManualAlertDto'];
export type ManualAlertList = components['schemas']['ManualAlertListDto'];
export type ManualAlertPreview = components['schemas']['ManualAlertPreviewDto'];
export type AlertsReport = components['schemas']['AlertsReportDto'];
export type AlertsReportFilters = Omit<
  operations['AlertsReportController_get_v1']['parameters']['query'],
  'format'
>;
export type NotificationPrefs = components['schemas']['NotificationPrefsDto'];

export async function getManualAlerts(
  params: { page?: number; pageSize?: number },
  signal: AbortSignal,
): Promise<ManualAlertList> {
  return (await apiClient.get<ManualAlertList>('/attention/manual', { params, signal })).data;
}

export async function sendManualAlert(body: CreateManualAlertInput): Promise<ManualAlert> {
  return (await apiClient.post<ManualAlert>('/attention/manual', body)).data;
}

export async function withdrawManualAlert(id: string): Promise<void> {
  await apiClient.delete(`/attention/manual/${id}`);
}

export async function previewManualAlert(
  audience: ManualAudience,
  signal: AbortSignal,
): Promise<ManualAlertPreview> {
  return (
    await apiClient.post<ManualAlertPreview>('/attention/manual/preview', { audience }, { signal })
  ).data;
}

export async function getAlertsReport(
  filters: AlertsReportFilters,
  signal: AbortSignal,
): Promise<AlertsReport> {
  return (
    await apiClient.get<AlertsReport>('/attention/report', {
      params: { ...filters, format: 'json' },
      signal,
    })
  ).data;
}

export async function getAlertsReportCsv(filters: AlertsReportFilters): Promise<Blob> {
  const res = await apiClient.get<Blob>('/attention/report', {
    params: { ...filters, format: 'csv' },
    responseType: 'blob',
  });
  return res.data instanceof Blob ? res.data : new Blob([res.data], { type: 'text/csv' });
}

export async function getNotificationPrefs(signal: AbortSignal): Promise<NotificationPrefs> {
  return (await apiClient.get<NotificationPrefs>('/users/me/preferences/notifications', { signal }))
    .data;
}

export async function updateNotificationPrefs(
  mutedCategories: NotificationPrefs['mutedCategories'],
): Promise<NotificationPrefs> {
  return (
    await apiClient.patch<NotificationPrefs>('/users/me/preferences/notifications', {
      mutedCategories,
    })
  ).data;
}

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

/** The server caps `POST /attention/items/seen` at 100 ids. */
export const ATTENTION_SEEN_MAX = 100;

export async function getAttentionSummary(
  params: { role: string; locale: AttentionLocale },
  signal: AbortSignal,
): Promise<AttentionSummary> {
  return (await apiClient.get<AttentionSummary>('/attention/summary', { params, signal })).data;
}

export async function getAttentionItems(
  query: AttentionItemsQuery,
  signal: AbortSignal,
): Promise<AlertItemsPage> {
  return (await apiClient.get<AlertItemsPage>('/attention/items', { params: query, signal })).data;
}

export async function hideAttentionItem(recipientId: string): Promise<AlertItem> {
  return (await apiClient.post<AlertItem>(`/attention/items/${recipientId}/hide`)).data;
}

export async function snoozeAttentionItem(
  recipientId: string,
  body: { choice: SnoozeChoice; date?: string },
): Promise<AlertItem> {
  return (await apiClient.post<AlertItem>(`/attention/items/${recipientId}/snooze`, body)).data;
}

export async function markAttentionSeen(recipientIds: string[]): Promise<{ updated: number }> {
  return (
    await apiClient.post<{ updated: number }>('/attention/items/seen', {
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

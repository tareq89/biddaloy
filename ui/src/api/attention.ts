import type { AlertCategory, AlertItem, AttentionSummary } from '@biddaloy/shared';

import { apiClient } from './client';
import type { components } from './schema';

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

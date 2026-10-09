import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { apiClient } from '../api/client';
import type { components } from '../api/schema';

import { createEntityKeys } from './query-keys';
import { shouldRetryQuery } from './retry';

// [28.3.1] Incident DTOs are camelCase on the wire (unlike the ACR ones).
export type Incident = components['schemas']['IncidentResponseDto'];
export type CreateIncidentInput = components['schemas']['CreateIncidentDto'];
export type IncidentType = Incident['type'];
export type IncidentSeverity = Incident['severity'];

export interface IncidentListFilters {
  staffUserId?: string;
  type?: IncidentType;
}

export const incidentKeys = createEntityKeys<IncidentListFilters>('incidents');

/** List incidents (never ones about the caller). */
export function useIncidents(filters: IncidentListFilters = {}) {
  return useQuery({
    queryKey: incidentKeys.list(filters),
    queryFn: async ({ signal }) =>
      (await apiClient.get<Incident[]>('/incidents', { params: filters, signal })).data,
    retry: shouldRetryQuery,
  });
}

export function useReportIncident() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: CreateIncidentInput) =>
      (await apiClient.post<Incident>('/incidents', input)).data,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: incidentKeys.lists() });
    },
  });
}

/** [35.4.3] `GET /presets/status` — AVAILABLE / APPLIED / CUSTOM (D26). */
import type { PresetStatus } from '@biddaloy/shared';
import { apiClient } from '@biddaloy/ui/api';
import { shouldRetryQuery } from '@biddaloy/ui/hooks';
import { useQuery } from '@tanstack/react-query';

export const presetStatusKey = ['presets', 'status'] as const;

export function usePresetStatus() {
  return useQuery({
    queryKey: presetStatusKey,
    queryFn: async () => (await apiClient.get<PresetStatus>('/presets/status')).data,
    retry: shouldRetryQuery,
  });
}

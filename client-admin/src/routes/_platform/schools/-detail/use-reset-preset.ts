import { apiClient, ApiError, type components } from '@biddaloy/ui/api';
import { useMutation } from '@tanstack/react-query';

export type ResetPresetResult = components['schemas']['ResetPresetResponseDto'];

export interface PresetBlocker {
  entity: string;
  count: number;
}

/** How a failed reset should be shown. Over HTTP the 409 code sits under `details`. */
export type ResetPresetFailure =
  { kind: 'blocked'; blockers: PresetBlocker[] } | { kind: 'notApplied' } | { kind: 'generic' };

export function classifyResetError(error: unknown): ResetPresetFailure {
  if (error instanceof ApiError && error.statusCode === 409) {
    const code = error.details?.['code'];
    if (code === 'PRESET_NOT_APPLIED') return { kind: 'notApplied' };
    if (code === 'PRESET_RESET_BLOCKED') {
      const raw = error.details?.['blockers'];
      return { kind: 'blocked', blockers: Array.isArray(raw) ? (raw as PresetBlocker[]) : [] };
    }
  }
  return { kind: 'generic' };
}

/** `POST /platform/schools/:id/preset/reset` (SUPER_ADMIN only). */
export function useResetPreset(schoolId: string) {
  return useMutation({
    mutationFn: async (input: { reason: string }) =>
      (await apiClient.post<ResetPresetResult>(`/platform/schools/${schoolId}/preset/reset`, input))
        .data,
  });
}

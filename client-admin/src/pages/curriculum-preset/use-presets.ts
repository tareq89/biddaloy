/**
 * [35.4.3] Preset list, preview and apply. Response types are hand-typed
 * against the server (`presets.controller.ts`'s `PresetPreview`,
 * `PresetApplyResult`) because `schema.d.ts` types these bodies as
 * `Record<string, never>`.
 */
import type { PresetPack, PresetSummary } from '@biddaloy/shared';
import { apiClient } from '@biddaloy/ui/api';
import { schoolSettingsKeys, shouldRetryQuery } from '@biddaloy/ui/hooks';
import { useTranslation } from '@biddaloy/ui/i18n';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { presetStatusKey } from './use-preset-status';

export type { PresetSummary };

export interface PresetPreview {
  summary: PresetSummary;
  stages: PresetPack['stages'];
  versions: NonNullable<PresetPack['versions']>;
  classes: PresetPack['classes'];
  subjects: PresetPack['subjects'];
  /** Not sent by the server at this base — #1303 / the choice-group amendment
   * needs it so the sheet can show "One of: …". Absent = counts only. */
  classSubjects?: PresetPack['classSubjects'];
  groups: string[];
  gradingScale: PresetPack['gradingScale'];
  terms: PresetPack['terms'];
  examTemplates: { name: string; rowCount: number }[];
  certificates: PresetPack['certificates'];
  counts: Record<
    'stages' | 'classes' | 'subjects' | 'classSubjects' | 'terms' | 'examTemplates',
    number
  >;
}

export interface ApplyPresetInput {
  preset_id: string;
  start_year: number;
  stages: string[];
  versions?: string[];
}

export interface ApplyPresetResult {
  created: Record<string, number>;
}

export function usePresetList() {
  return useQuery({
    queryKey: ['presets', 'list'],
    queryFn: async () => (await apiClient.get<PresetSummary[]>('/presets')).data,
    retry: shouldRetryQuery,
  });
}

export function usePresetPreview(id: string | null) {
  return useQuery({
    queryKey: ['presets', 'detail', id],
    // Ids contain a slash ('bd/nctb') — always encode.
    queryFn: async () =>
      (await apiClient.get<PresetPreview>(`/presets/${encodeURIComponent(id ?? '')}`)).data,
    enabled: id !== null,
    retry: shouldRetryQuery,
  });
}

export function useApplyPreset(schoolId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: ApplyPresetInput) =>
      (await apiClient.post<ApplyPresetResult>('/presets/apply', input)).data,
    // A 409 PRESET_NOT_FRESH also means status moved on — refresh it too.
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: presetStatusKey });
      void queryClient.invalidateQueries({ queryKey: schoolSettingsKeys.detail(schoolId) });
    },
  });
}

/** Picks the active-language side of a pack's `{ en, bn }` text. */
export function usePickText() {
  const { i18n } = useTranslation();
  return (text: { en: string; bn: string }) => (i18n.language.startsWith('bn') ? text.bn : text.en);
}

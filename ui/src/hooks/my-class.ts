/** [47.3] `GET /my-class/sections` — current-year sections the caller is a
 * (assistant) class teacher of, with the role per section (D26). */
import { queryOptions, useQuery } from '@tanstack/react-query';

import { apiClient } from '../api/client';
import type { components } from '../api/schema';

import { createEntityKeys } from './query-keys';
import { shouldRetryQuery } from './retry';

export type MyClassSection = components['schemas']['MyClassSectionDto'];

export const myClassKeys = createEntityKeys('my-class');

export function myClassSectionsQueryOptions() {
  return queryOptions({
    queryKey: myClassKeys.list(),
    queryFn: async ({ signal }) => {
      const res = await apiClient.get<MyClassSection[]>('/my-class/sections', { signal });
      return res.data;
    },
    retry: shouldRetryQuery,
  });
}

export function useMyClassSections() {
  return useQuery(myClassSectionsQueryOptions());
}

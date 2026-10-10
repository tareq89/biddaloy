import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { getNotificationPrefs, updateNotificationPrefs } from '../../api/attention';
import { shouldRetryQuery } from '../retry';
import { userKeys } from '../users';

export const notificationPrefsKey = ['users', 'me', 'notification-prefs'] as const;

export function useNotificationPrefs() {
  return useQuery({
    queryKey: notificationPrefsKey,
    queryFn: ({ signal }) => getNotificationPrefs(signal),
    retry: shouldRetryQuery,
  });
}

export function useUpdateNotificationPrefs() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: updateNotificationPrefs,
    onSuccess: (prefs) => {
      queryClient.setQueryData(notificationPrefsKey, prefs);
      return queryClient.invalidateQueries({ queryKey: userKeys.detail('me') });
    },
  });
}

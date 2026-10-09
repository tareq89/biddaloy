import { useMutation, useQueryClient } from '@tanstack/react-query';

import {
  hideAttentionItem,
  markAttentionSeen,
  snoozeAttentionItem,
  type SnoozeChoice,
} from '../../api/attention';

import { attentionKeys } from './use-attention-queries';

export function useHideAttentionItem() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (recipientId: string) => hideAttentionItem(recipientId),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: attentionKeys.all }),
  });
}

export function useSnoozeAttentionItem() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      recipientId,
      ...body
    }: {
      recipientId: string;
      choice: SnoozeChoice;
      date?: string;
    }) => snoozeAttentionItem(recipientId, body),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: attentionKeys.all }),
  });
}

/** No invalidation: nothing on screen changes, it only feeds D24 counts. */
export function useMarkAttentionSeen() {
  return useMutation({ mutationFn: (recipientIds: string[]) => markAttentionSeen(recipientIds) });
}

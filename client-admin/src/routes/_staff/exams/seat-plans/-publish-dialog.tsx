/**
 * [25.7] step 5: publish a DRAFT plan. Mirrors `results/-publish-dialog.tsx`'s
 * confirm shape — a plain write, no approval gate (unlike results' reopen).
 * A failure shows one translated line, never the server text.
 */
import { ApiError } from '@biddaloy/ui/api';
import { ConfirmDialog } from '@biddaloy/ui/components';
import { usePublishSeatPlan, useSeatPlanDetail } from '@biddaloy/ui/hooks';
import { useTranslation } from '@biddaloy/ui/i18n';

export interface PublishSeatPlanDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  planId: string;
}

export function PublishSeatPlanDialog({ open, onOpenChange, planId }: PublishSeatPlanDialogProps) {
  const { t } = useTranslation('seatPlansDetail');
  const publish = usePublishSeatPlan(planId);
  // Cached by the detail page; only used to label rooms in a ROOM_CONFLICT sentence.
  const rooms = useSeatPlanDetail(planId).data?.rooms ?? [];

  function handleOpenChange(next: boolean) {
    if (!next && publish.isPending) return;
    if (!next) publish.reset();
    onOpenChange(next);
  }

  const details = publish.error instanceof ApiError ? publish.error.details : undefined;
  const conflictRooms =
    details?.code === 'ROOM_CONFLICT' && Array.isArray(details.conflicts)
      ? [
          ...new Set(
            (details.conflicts as Array<{ room_id?: unknown }>).map((c) => String(c.room_id)),
          ),
        ]
          .map((id) => rooms.find((r) => r.room_id === id))
          .map((r) => (r?.room_no ? (r.building ? `${r.building} — ${r.room_no}` : r.room_no) : ''))
          .filter(Boolean)
      : [];
  const errorLine =
    conflictRooms.length > 0
      ? t('publish.errorRoomConflict', { rooms: conflictRooms.join(', ') })
      : t('publish.errorMessage');

  return (
    <ConfirmDialog
      open={open}
      onOpenChange={handleOpenChange}
      tone="default"
      title={t('publish.title')}
      description={
        publish.isError ? `${t('publish.description')} ${errorLine}` : t('publish.description')
      }
      confirmLabel={t('publish.confirm')}
      busy={publish.isPending}
      onConfirm={() => publish.mutate(undefined, { onSuccess: () => onOpenChange(false) })}
    />
  );
}

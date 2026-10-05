/**
 * [17.4.2] / [31.4] Event details — a small `Dialog` (no dedicated `Sheet`
 * primitive). A locked (past) event hides Edit/Delete entirely. Delete asks
 * first (`ConfirmDialog`).
 */
import {
  Button,
  ConfirmDialog,
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  StatusBadge,
} from '@biddaloy/ui/components';
import type { CalendarEvent } from '@biddaloy/ui/hooks';
import { useRegionConfig, useTranslation } from '@biddaloy/ui/i18n';
import { formatDate, formatDateRange } from '@biddaloy/ui/utils';
import { Trash2Icon } from 'lucide-react';
import * as React from 'react';

export interface EventDetailsSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  event: CalendarEvent | undefined;
  canManage: boolean;
  onEdit: () => void;
  onDelete: () => void;
  onPublish: () => void;
  /** A delete is in flight: the dialogs cannot be dismissed. */
  deleting?: boolean;
  /** Delete or publish failed: show a translated alert. */
  actionFailed?: boolean;
}

export function EventDetailsSheet({
  open,
  onOpenChange,
  event,
  canManage,
  onEdit,
  onDelete,
  onPublish,
  deleting = false,
  actionFailed = false,
}: EventDetailsSheetProps) {
  const { t } = useTranslation('calendar');
  const regionConfig = useRegionConfig();
  const [confirmOpen, setConfirmOpen] = React.useState(false);

  if (!event) return null;

  const canEdit = canManage && !event.is_locked;

  return (
    <>
      <Dialog open={open} onOpenChange={(next) => !deleting && onOpenChange(next)}>
        <DialogContent size="sm">
          <DialogHeader>
            <DialogTitle>{event.name}</DialogTitle>
          </DialogHeader>

          <dl className="flex flex-col gap-3">
            <div>
              <dt className="text-caption text-text-secondary">{t('eventForm.type')}</dt>
              <dd className="flex items-center gap-2">
                {t(`types.${event.type}`)}
                {!event.published && <StatusBadge tone="neutral" label={t('eventDetails.draft')} />}
              </dd>
            </div>
            <div>
              <dt className="text-caption text-text-secondary">{t('eventForm.startDate')}</dt>
              <dd>
                {event.end_date !== event.start_date
                  ? formatDateRange(event.start_date, event.end_date, regionConfig)
                  : formatDate(event.start_date, regionConfig)}
              </dd>
            </div>
            {event.description && (
              <div>
                <dt className="text-caption text-text-secondary">{t('eventForm.description')}</dt>
                <dd>{event.description}</dd>
              </div>
            )}
          </dl>

          {event.is_locked && (
            <p role="status" className="text-text-secondary">
              {t('eventDetails.locked')}
            </p>
          )}
          {actionFailed && (
            <p role="alert" className="text-destructive">
              {t('eventDetails.actionFailed')}
            </p>
          )}

          {canManage && (
            <DialogFooter>
              {canEdit && (
                <Button
                  type="button"
                  variant="outline"
                  className="text-destructive"
                  onClick={() => setConfirmOpen(true)}
                >
                  <Trash2Icon aria-hidden="true" />
                  {t('eventDetails.delete')}
                </Button>
              )}
              {!event.published && (
                <Button type="button" variant="outline" onClick={onPublish}>
                  {t('eventDetails.publish')}
                </Button>
              )}
              {canEdit && (
                <Button type="button" onClick={onEdit}>
                  {t('eventDetails.edit')}
                </Button>
              )}
            </DialogFooter>
          )}
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        tone="danger"
        title={t('eventDetails.deleteConfirmTitle')}
        description={t('eventDetails.deleteConfirmDescription', { name: event.name })}
        confirmLabel={t('eventDetails.delete')}
        busy={deleting}
        onConfirm={() => {
          onDelete();
          setConfirmOpen(false);
        }}
      />
    </>
  );
}

/**
 * [17.4.2] Event details panel — built on `Dialog` (no dedicated `Sheet`
 * primitive exists in `@biddaloy/ui/components` yet, see this ticket's
 * plan-comment note). A locked (past) event hides Edit/Delete entirely,
 * matching AC "past event shows lock and no edit".
 */
import {
  Button,
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@biddaloy/ui/components';
import type { CalendarEvent } from '@biddaloy/ui/hooks';
import { useRegionConfig, useTranslation } from '@biddaloy/ui/i18n';
import { formatDate, parseServerDate } from '@biddaloy/ui/utils';

export interface EventDetailsSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  event: CalendarEvent | undefined;
  canManage: boolean;
  onEdit: () => void;
  onDelete: () => void;
  onPublish: () => void;
}

export function EventDetailsSheet({
  open,
  onOpenChange,
  event,
  canManage,
  onEdit,
  onDelete,
  onPublish,
}: EventDetailsSheetProps) {
  const { t } = useTranslation('calendar');
  const regionConfig = useRegionConfig();

  if (!event) return null;

  const canEdit = canManage && !event.is_locked;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{event.name}</DialogTitle>
        </DialogHeader>

        <dl className="flex flex-col gap-2 text-sm">
          <div>
            <dt className="font-medium">{t('eventForm.type')}</dt>
            <dd>{t(`types.${event.type}`)}</dd>
          </div>
          <div>
            <dt className="font-medium">{t('eventForm.startDate')}</dt>
            <dd>
              {formatDate(parseServerDate(event.start_date), regionConfig)}
              {event.end_date !== event.start_date
                ? ` – ${formatDate(parseServerDate(event.end_date), regionConfig)}`
                : ''}
            </dd>
          </div>
          {event.description && (
            <div>
              <dt className="font-medium">{t('eventForm.description')}</dt>
              <dd>{event.description}</dd>
            </div>
          )}
          {!event.published && <dd className="text-muted-foreground">{t('eventDetails.draft')}</dd>}
          {event.is_locked && (
            <p role="status" className="text-muted-foreground">
              {t('eventDetails.locked')}
            </p>
          )}
        </dl>

        {canManage && (
          <DialogFooter>
            {!event.published && (
              <Button type="button" variant="outline" onClick={onPublish}>
                {t('eventDetails.publish')}
              </Button>
            )}
            {canEdit && (
              <>
                <Button type="button" variant="outline" onClick={onEdit}>
                  {t('eventDetails.edit')}
                </Button>
                <Button type="button" variant="destructive" onClick={onDelete}>
                  {t('eventDetails.delete')}
                </Button>
              </>
            )}
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  );
}

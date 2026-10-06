/** [13.5.1] What the trial bar opens: days left, students used, data kept, contact link. */
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@biddaloy/ui/components';
import { useTranslation } from '@biddaloy/ui/i18n';

/** Same allow-list the trial-ended screen uses. */
export const isSafeSupportUrl = (url: string | null | undefined): url is string =>
  !!url && /^(https:|mailto:)/i.test(url);

export interface TrialDetailsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  daysLeft: number;
  seats: { used: number; limit: number | null };
  supportUrl: string | null;
}

export function TrialDetailsDialog({
  open,
  onOpenChange,
  daysLeft,
  seats,
  supportUrl,
}: TrialDetailsDialogProps) {
  const { t } = useTranslation('trial');
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('details.title')}</DialogTitle>
          <DialogDescription>{t('details.body')}</DialogDescription>
        </DialogHeader>
        <ul className="flex flex-col gap-1">
          <li>{t('details.daysLeft', { days: Math.max(daysLeft, 0) })}</li>
          <li>
            {seats.limit === null
              ? t('details.studentsNoLimit', { used: seats.used })
              : t('details.students', { used: seats.used, limit: seats.limit })}
          </li>
          <li>{t('details.kept')}</li>
        </ul>
        {isSafeSupportUrl(supportUrl) && (
          <Button asChild className="w-full sm:w-auto sm:self-start">
            <a href={supportUrl}>{t('ended.contact')}</a>
          </Button>
        )}
      </DialogContent>
    </Dialog>
  );
}

/** [13.5.1] Trial countdown bar at the top of the staff shell. ADMIN only, trial schools only. */
import { UserRole } from '@biddaloy/shared';
import { Button, NoticeBar } from '@biddaloy/ui/components';
import { onboardingStatusQueryOptions, useActiveRole } from '@biddaloy/ui/hooks';
import { useTranslation } from '@biddaloy/ui/i18n';
import { useQuery } from '@tanstack/react-query';
import * as React from 'react';

import { TrialDetailsDialog } from './trial-details-dialog';

const DANGER_DAYS = 3;

export function TrialBar({ className }: { className?: string }) {
  const { t } = useTranslation('trial');
  const role = useActiveRole();
  const [open, setOpen] = React.useState(false);
  const { data } = useQuery({
    ...onboardingStatusQueryOptions(),
    enabled: role === UserRole.ADMIN,
  });
  if (role !== UserRole.ADMIN || !data?.trial) return null;
  const { days_left: days, seats } = data.trial;
  const text =
    days <= 0
      ? t('barLastDay')
      : seats.limit === null
        ? t('barNoLimit', { days })
        : t('bar', { days, used: seats.used, limit: seats.limit });
  return (
    <>
      <NoticeBar
        tone={days <= DANGER_DAYS ? 'danger' : 'warning'}
        onOpenDetails={() => setOpen(true)}
        {...(className ? { className } : {})}
        action={
          <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
            {t('details.open')}
          </Button>
        }
      >
        {text}
      </NoticeBar>
      <TrialDetailsDialog
        open={open}
        onOpenChange={setOpen}
        daysLeft={days}
        seats={seats}
        supportUrl={data.support_url}
      />
    </>
  );
}

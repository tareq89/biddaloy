/** [67.2.04] Opens the trial details dialog from `/dashboard?trial=1` (the `trial.ending` alert's action). ADMIN only. */
import { UserRole } from '@biddaloy/shared';
import { onboardingStatusQueryOptions, useActiveRole } from '@biddaloy/ui/hooks';
import { useQuery } from '@tanstack/react-query';
import { useSearch } from '@tanstack/react-router';

import { useLandingFlag } from '../../routes/_staff/-use-landing-flag';

import { TrialDetailsDialog } from './trial-details-dialog';

export function TrialDetailsLanding() {
  const role = useActiveRole();
  const search = useSearch({ strict: false }) as Record<string, unknown>;
  const { data } = useQuery({
    ...onboardingStatusQueryOptions(),
    // Mounted in the staff shell: fetch only when landing on `?trial=1`,
    // not on every ADMIN page load.
    enabled: role === UserRole.ADMIN && String(search.trial) === '1',
    // Shell chrome: never throw a suspension 403 [15.4.2].
    throwOnError: false,
  });
  const [open, setOpen] = useLandingFlag('trial', role === UserRole.ADMIN && Boolean(data?.trial));
  if (role !== UserRole.ADMIN || !data?.trial) return null;
  return (
    <TrialDetailsDialog
      open={open}
      onOpenChange={setOpen}
      daysLeft={data.trial.days_left}
      seats={data.trial.seats}
      supportUrl={data.support_url}
    />
  );
}

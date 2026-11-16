/**
 * [3329 / 4292] One banner above the app shell: the net is off or slow, and
 * how many writes wait. D7: one sentence + one button.
 *
 * Fails open (D18): unknown state shows nothing. Offline is read from
 * `navigator.onLine` (definite "no network" only); slow is "some request has
 * been pending for more than 4 s" (D16), read from the query client's
 * fetching count, so there is no new global.
 *
 * Retry only re-reads (refetches active queries). It never replays a queued
 * write: writes are never auto-retried (Rule 25) and the queue has its own
 * explicit "Send now" in `SyncStatus`.
 *
 * Composition only: `Button` and the muted/border tokens, like
 * `cached-data-notice.tsx`.
 */
import { useIsFetching, useQueryClient } from '@tanstack/react-query';
import { CloudOffIcon, HourglassIcon } from 'lucide-react';
import * as React from 'react';

import { useOnline } from '../hooks/use-online';
import { useSyncQueue } from '../hooks/use-sync-queue';
import { useTranslation } from '../i18n';
import { cn } from '../primitives/lib/utils';

import { Button } from './button';

/** D16: slow-network hint after 4 s. */
export const SLOW_AFTER_MS = 4000;

export interface ConnectionBannerViewProps {
  online: boolean;
  slow: boolean;
  /** Writes waiting in the offline queue. */
  queued: number;
  onRetry: () => void;
  className?: string;
}

export function ConnectionBannerView({
  online,
  slow,
  queued,
  onRetry,
  className,
}: ConnectionBannerViewProps) {
  const { t } = useTranslation(['states', 'common']);
  if (online && !slow) return null;
  const key = online ? 'slow' : 'offline';
  const Icon = online ? HourglassIcon : CloudOffIcon;
  return (
    <div
      // `status`: important, not urgent enough to interrupt the sentence being read.
      role="status"
      className={cn(
        'flex items-center gap-2 border-b border-border-subtle bg-muted px-4 py-2 text-sm text-muted-foreground',
        className,
      )}
    >
      <Icon aria-hidden="true" className="size-4 shrink-0" />
      {/* One line on a phone: the title and the queue count stay, the longer body appears from `sm`. */}
      <p className="min-w-0 flex-1 truncate">
        <span className="font-medium text-foreground">{t(`states:${key}.title`)}</span>
        <span className="hidden sm:inline"> · {t(`states:${key}.body`)}</span>
        {queued > 0 && (
          <span className="ms-2">{t('common:sync.pendingCount', { count: queued })}</span>
        )}
      </p>
      {!online && (
        <Button type="button" variant="outline" size="sm" className="shrink-0" onClick={onRetry}>
          {t('states:offline.retry')}
        </Button>
      )}
    </div>
  );
}

export function ConnectionBanner({ className }: { className?: string }) {
  const online = useOnline();
  const queryClient = useQueryClient();
  const fetching = useIsFetching() > 0;
  const { pending } = useSyncQueue();
  const [slow, setSlow] = React.useState(false);

  React.useEffect(() => {
    if (!fetching) {
      setSlow(false);
      return;
    }
    const timer = setTimeout(() => setSlow(true), SLOW_AFTER_MS);
    return () => clearTimeout(timer);
  }, [fetching]);

  return (
    <ConnectionBannerView
      online={online}
      slow={slow}
      queued={pending}
      onRetry={() => void queryClient.refetchQueries({ type: 'active' })}
      {...(className === undefined ? {} : { className })}
    />
  );
}

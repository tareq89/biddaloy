import { NoticeBar } from '@biddaloy/ui';
import { isTenantRestoringError } from '@biddaloy/ui/api';
import { useTranslation } from '@biddaloy/ui/i18n';
import { useQueryClient } from '@tanstack/react-query';
import * as React from 'react';

/** [68.1.2219] Presentational half, so Storybook can show it without a cache. */
export function RestoreInProgressNotice() {
  const { t } = useTranslation('common');
  return <NoticeBar tone="warning">{t('restoreBar.message')}</NoticeBar>;
}

/**
 * Shell warning bar shown after a save is refused with `423 TENANT_RESTORING`
 * (a backup restore is running). It goes away when a later save succeeds.
 *
 * State is read straight off the mutation cache: the most recently submitted
 * mutation that has finished decides. No polling, no dismiss button.
 * ponytail: the cache evicts finished mutations after its gcTime (5 min), so
 * the bar also clears then; add a timer-less refetch only if that matters.
 */
export function RestoreInProgressBar() {
  const mutationCache = useQueryClient().getMutationCache();
  const read = () => {
    let latest: { at: number; restoring: boolean } | undefined;
    for (const m of mutationCache.getAll()) {
      const { status, submittedAt, error } = m.state;
      if (status !== 'error' && status !== 'success') continue;
      if (!latest || submittedAt >= latest.at) {
        latest = {
          at: submittedAt,
          restoring: status === 'error' && isTenantRestoringError(error),
        };
      }
    }
    return latest?.restoring ?? false;
  };
  const restoring = React.useSyncExternalStore((cb) => mutationCache.subscribe(cb), read, read);
  return restoring ? <RestoreInProgressNotice /> : null;
}

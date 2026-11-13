import { ErrorState, toast } from '@biddaloy/ui/components';
import {
  ApprovalCancelledError,
  useOpsQueues,
  useOpsSystem,
  useReleaseRestoreLock,
  useRetryFailedQueue,
} from '@biddaloy/ui/hooks';
import { useTranslation } from '@biddaloy/ui/i18n';
import { PageContainer, PageHeader } from '@biddaloy/ui/shells';
import { createFileRoute } from '@tanstack/react-router';
import * as React from 'react';

import { loadRouteNamespaces } from '../../../route-loaders';

import { QueuesTable } from './-queues-table';
import { RestoreLockCard } from './-restore-lock-card';
import { SystemCard } from './-system-card';

/**
 * Epic 99 #3823: is the platform healthy. Queues (retry failed), the system card and the
 * restore lock release. Retry and Release ask for an owner code (`platform.ops_action`) through
 * the prompt host mounted in `_platform/route.tsx`. Refreshes every 30 s while the tab is visible.
 */
const REFRESH_MS = 30_000;

export const Route = createFileRoute('/_platform/operations/')({
  loader: () => loadRouteNamespaces('platformOperations', 'approval'),
  component: OperationsPage,
});

function OperationsPage() {
  const { t } = useTranslation('platformOperations');
  const queues = useOpsQueues();
  const system = useOpsSystem();
  const retry = useRetryFailedQueue();
  const release = useReleaseRestoreLock();

  const { refetch: refetchQueues } = queues;
  const { refetch: refetchSystem } = system;
  React.useEffect(() => {
    const id = setInterval(() => {
      if (document.visibilityState !== 'visible') return;
      void refetchQueues();
      void refetchSystem();
    }, REFRESH_MS);
    return () => clearInterval(id);
  }, [refetchQueues, refetchSystem]);

  async function run(action: () => Promise<string>, failed: string) {
    try {
      toast.success(await action());
    } catch (error) {
      // The owner closed the code prompt: nothing to say.
      if (!(error instanceof ApprovalCancelledError)) toast.error(failed);
    }
  }

  return (
    <PageContainer>
      <PageHeader title={t('title')} subtitle={t('caption')} />
      {system.isError ? (
        <ErrorState message={t('loadError')} onRetry={() => void system.refetch()} />
      ) : (
        system.data && <SystemCard system={system.data} />
      )}
      <QueuesTable
        queues={queues.data?.queues ?? []}
        loading={queues.isLoading}
        isFetching={queues.isFetching}
        {...(queues.isError ? { error: t('loadError') } : {})}
        busyName={retry.isPending ? retry.variables?.name : undefined}
        onRetry={(name) =>
          void run(
            async () => t('queues.retried', { count: (await retry.mutateAsync({ name })).retried }),
            t('queues.retryError'),
          )
        }
      />
      {system.data && (
        <RestoreLockCard
          restoring={system.data.restoring}
          busy={release.isPending}
          onRelease={(schoolId) =>
            void run(async () => {
              await release.mutateAsync({ schoolId });
              return t('restore.released');
            }, t('restore.releaseError'))
          }
        />
      )}
    </PageContainer>
  );
}

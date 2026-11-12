import { useCurrentUserId } from '@biddaloy/ui/hooks';
import { useTranslation } from '@biddaloy/ui/i18n';
import { DetailShell, useDetailShellTab } from '@biddaloy/ui/shells';
import { createFileRoute } from '@tanstack/react-router';
import { z } from 'zod';

import { ApprovalsTab } from '../../../features/cockpit/owners/approvals-tab';
import { HistoryTab } from '../../../features/cockpit/owners/history-tab';
import { OwnersTab } from '../../../features/cockpit/owners/owners-tab';
import { loadRouteNamespaces } from '../../../route-loaders';

/**
 * Epic 98 #3761: the platform owners page. Three tabs in the URL (`?tab=owners|approvals|history`).
 * The server is the security boundary (cockpit principal + `platform.*` step-up); this is the UI.
 * The code prompt host is mounted once in `_platform/route.tsx`.
 */
const TABS = ['owners', 'approvals', 'history'] as const;

export const Route = createFileRoute('/_platform/platform-owners/')({
  validateSearch: z.object({ tab: z.enum(TABS).optional().catch(undefined) }),
  loader: () => loadRouteNamespaces('platformOwners', 'approval'),
  component: PlatformOwnersPage,
});

function PlatformOwnersPage() {
  const { t } = useTranslation('platformOwners');
  const currentUserId = useCurrentUserId();
  const [tab, setTab] = useDetailShellTab(TABS);
  return (
    <DetailShell
      name={t('title')}
      tabs={[
        {
          id: 'owners',
          label: t('tabs.owners'),
          content: (
            <OwnersTab currentUserId={currentUserId} onOpenApprovals={() => setTab('approvals')} />
          ),
        },
        {
          id: 'approvals',
          label: t('tabs.approvals'),
          content: <ApprovalsTab currentUserId={currentUserId} />,
        },
        { id: 'history', label: t('tabs.history'), content: <HistoryTab /> },
      ]}
      activeTab={tab}
      onTabChange={setTab}
    />
  );
}

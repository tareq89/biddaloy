import { useTranslation } from '@biddaloy/ui/i18n';
import { PageContainer, PageHeader } from '@biddaloy/ui/shells';
import { Outlet, createFileRoute, useRouterState } from '@tanstack/react-router';

import { MoneyTabs, moneyTabOf } from '../../../features/cockpit/money/money-tabs';
import { loadRouteNamespaces } from '../../../route-loaders';

/**
 * [100.5.gI-04] Money shell (D13): heading, five tab links, one URL per tab. The tab title
 * "<tab> · টাকা-পয়সা · Cockpit" comes from the breadcrumb registry (`route-crumbs.ts`) through
 * `_platform/route.tsx`'s `document.title` effect.
 */
export const Route = createFileRoute('/_platform/money')({
  loader: () => loadRouteNamespaces('money', 'moneyStock'),
  component: MoneyShell,
});

function MoneyShell() {
  const { t } = useTranslation('money');
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  return (
    <PageContainer>
      <PageHeader title={t('title')} subtitle={t('caption')} />
      <MoneyTabs active={moneyTabOf(pathname)} />
      <Outlet />
    </PageContainer>
  );
}

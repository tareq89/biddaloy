/**
 * [38.4.3] `/fees/fines/rules` — a child page of `/fees/fines`, reached from
 * its header button. Hosts 38.4.2's self-contained `<RulesPanel />` (it owns
 * its own academic-year selection and its page header).
 */
import { RoutePending } from '@biddaloy/ui/components';
import { useTranslation } from '@biddaloy/ui/i18n';
import { PageContainer } from '@biddaloy/ui/shells';
import { createFileRoute } from '@tanstack/react-router';

import { loadRouteNamespaces } from '../../../../route-loaders';

import { RulesPanel } from './-rules/rules-panel';

export const Route = createFileRoute('/_staff/fees/fines/rules')({
  loader: () => loadRouteNamespaces('fines', 'fees', 'common'),
  pendingComponent: FinesRulesPending,
  component: FinesRulesPage,
});

function FinesRulesPage() {
  return (
    <PageContainer>
      <RulesPanel />
    </PageContainer>
  );
}

function FinesRulesPending() {
  const { t } = useTranslation('nav');
  return <RoutePending variant="list" label={t('routePending.label', { ns: 'nav' })} />;
}

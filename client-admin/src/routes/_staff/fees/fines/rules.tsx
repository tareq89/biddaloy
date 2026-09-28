/**
 * [38.4.3] `/fees/fines/rules` — same tab shell as `index.tsx`, hosting
 * 38.4.2's self-contained `<RulesPanel />` (it owns its own academic-year
 * selection, no wiring needed here — see that component's own header
 * comment).
 */
import { RoutePending } from '@biddaloy/ui/components';
import { useTranslation } from '@biddaloy/ui/i18n';
import { createFileRoute } from '@tanstack/react-router';

import { loadRouteNamespaces } from '../../../../route-loaders';

import { FinesTabs } from './-list/fines-tabs';
import { RulesPanel } from './-rules/rules-panel';

export const Route = createFileRoute('/_staff/fees/fines/rules')({
  loader: () => loadRouteNamespaces('fines', 'fees', 'common'),
  pendingComponent: FinesRulesPending,
  component: FinesRulesPage,
});

function FinesRulesPage() {
  return (
    <>
      <FinesTabs />
      <RulesPanel />
    </>
  );
}

function FinesRulesPending() {
  const { t } = useTranslation('nav');
  return <RoutePending variant="list" label={t('routePending.label', { ns: 'nav' })} />;
}

import { ApprovalModalHostProvider } from '@biddaloy/ui/hooks';
import { useTranslation } from '@biddaloy/ui/i18n';
import { PageContainer, PageHeader } from '@biddaloy/ui/shells';
import { createFileRoute, useNavigate } from '@tanstack/react-router';

import {
  DevicesSection,
  RecoveryCodesSection,
  TwoStepCard,
  useOwnerMfaStatus,
} from '../../../features/cockpit/two-step/security-cards';
import { loadRouteNamespaces } from '../../../route-loaders';

/** [98.4.04] Owner security page, mockup section e (`_staff/security.tsx` shape). */
export const Route = createFileRoute('/_platform/owner-security/')({
  loader: () => loadRouteNamespaces('ownerSecurity', 'approval'),
  component: OwnerSecurityPage,
});

function OwnerSecurityPage() {
  const { t } = useTranslation('ownerSecurity');
  const navigate = useNavigate();
  const mfa = useOwnerMfaStatus();
  return (
    <ApprovalModalHostProvider>
      <PageContainer size="narrow">
        <PageHeader title={t('title')} subtitle={t('subtitle')} />
        <TwoStepCard enrolled={mfa.enrolled} failed={mfa.failed} onRetry={mfa.retry} />
        <RecoveryCodesSection remaining={mfa.remaining} />
        <DevicesSection onSignedOutEverywhere={() => void navigate({ to: '/sign-in' as '/' })} />
      </PageContainer>
    </ApprovalModalHostProvider>
  );
}

import { RoutePending } from '@biddaloy/ui/components';
import { onboardingStatusQueryOptions } from '@biddaloy/ui/hooks';
import { RegionConfigProvider, useTenantRegionConfig, useTranslation } from '@biddaloy/ui/i18n';
import { createFileRoute } from '@tanstack/react-router';
import { z } from 'zod';

import { ExcelSetup } from '../../features/onboarding/excel/excel-setup';
import { GuidedSetup } from '../../features/onboarding/guided/guided-setup';
import { PeopleStep } from '../../features/onboarding/people/people-step';
import { SummaryStep } from '../../features/onboarding/summary/summary-step';
import { WelcomeWizard } from '../../features/onboarding/welcome-wizard';
import { downloadStaffTemplate } from '../../features/staff-import/template';
import { loadRouteNamespaces, swallowUnlessOffline } from '../../route-loaders';

import { downloadTemplate } from './students/-import/template';

/** Wizard position lives in the URL (`use-onboarding-step.ts`). Junk falls
 * back to the first step / the three doors / question 1. */
const welcomeSearchSchema = z.object({
  step: z.enum(['setup', 'people', 'done']).optional().catch(undefined),
  path: z.enum(['guided', 'excel']).optional().catch(undefined),
  q: z.number().int().min(1).max(3).optional().catch(undefined),
});

/**
 * [13.6.1] `/welcome` — the full-page setup wizard, ADMIN only (gated in
 * `route-permissions.ts`; `WelcomeWizard` writes `seen: true` on mount so the
 * dashboard's first-visit gate stops redirecting here).
 */
export const Route = createFileRoute('/_staff/welcome')({
  staticData: { chromeless: true },
  validateSearch: welcomeSearchSchema,
  loader: ({ context: { queryClient } }) =>
    Promise.all([
      queryClient.ensureQueryData(onboardingStatusQueryOptions()).catch(swallowUnlessOffline),
      loadRouteNamespaces(
        'onboardingSetup',
        'onboardingPeople',
        'backup',
        'trial',
        'staff',
        'staffImport',
        'studentImport',
      ),
    ]),
  pendingComponent: WelcomePending,
  component: WelcomePage,
});

function WelcomePage() {
  const regionConfig = useTenantRegionConfig();
  return (
    <RegionConfigProvider value={regionConfig}>
      <WelcomeWizard
        guided={<GuidedSetup />}
        excel={<ExcelSetup />}
        people={
          <PeopleStep
            onDownloadStudentSample={downloadTemplate}
            onDownloadStaffSample={() => void downloadStaffTemplate()}
          />
        }
        summary={<SummaryStep />}
      />
    </RegionConfigProvider>
  );
}

function WelcomePending() {
  const { t } = useTranslation('nav');
  return <RoutePending variant="form" label={t('routePending.label')} />;
}

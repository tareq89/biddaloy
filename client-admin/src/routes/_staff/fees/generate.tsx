import { Permission } from '@biddaloy/shared';
import { EmptyState } from '@biddaloy/ui/components';
import { useHasPermission } from '@biddaloy/ui/hooks';
import { RegionConfigProvider, useTenantRegionConfig, useTranslation } from '@biddaloy/ui/i18n';
import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { z } from 'zod';

import { GenerateFeesWizard } from './-generate/generate-fees-wizard';

/**
 * `/fees/generate` — [8.11.6]'s "generate a month's fees" wizard.
 *
 * `step` is `WizardShell`'s own `useWizardShellStep` contract (`?step=`
 * as the source of truth for the active step, so it survives a refresh),
 * exactly as `/payments/record` declares it.
 *
 * The permission check here is a **UX** gate, not the security boundary:
 * `_staff` admits every staff role (including TEACHER), but
 * `POST /fees/generate` is `@Roles(ADMIN, ACCOUNTANT)` server-side. Without
 * this, a teacher who typed the URL would get a wizard they could fill in
 * completely and only discover at the final, irreversible-looking submit
 * that the server says no.
 */
const generateFeesSearchSchema = z.object({
  step: z.string().optional().catch(undefined),
});

export const Route = createFileRoute('/_staff/fees/generate')({
  validateSearch: generateFeesSearchSchema,
  component: GenerateFeesPage,
});

function GenerateFeesPage() {
  const { t } = useTranslation('feeGeneration');
  const navigate = useNavigate();
  const canGenerate = useHasPermission(Permission.FEE_GENERATE);
  // No ambient `RegionConfigProvider` above the route tree — same
  // reasoning `payments/record.tsx` gives. The academic year's date range
  // is formatted with the tenant's own date settings, which would
  // silently fall back to the provider's hardcoded default without this.
  const regionConfig = useTenantRegionConfig();

  if (!canGenerate) {
    return (
      <EmptyState
        title={t('forbidden.title')}
        explanation={t('forbidden.explanation')}
        action={{ label: t('forbidden.action'), onClick: () => void navigate({ to: '/fees' }) }}
      />
    );
  }

  return (
    <RegionConfigProvider value={regionConfig}>
      <GenerateFeesWizard />
    </RegionConfigProvider>
  );
}

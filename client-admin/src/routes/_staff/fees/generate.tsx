import { RegionConfigProvider, useTenantRegionConfig } from '@biddaloy/ui/i18n';
import { createFileRoute } from '@tanstack/react-router';
import { z } from 'zod';

import { GenerateFeesWizard } from './-generate/generate-fees-wizard';

/**
 * `/fees/generate` — [8.11.6]'s "generate a month's fees" wizard.
 *
 * `step` is `WizardShell`'s own `useWizardShellStep` contract (`?step=`
 * as the source of truth for the active step, so it survives a refresh),
 * exactly as `/payments/record` declares it.
 *
 * Its own inline permission gate (`useHasPermission(FEE_GENERATE)`, an
 * `EmptyState` early-return escaping to `/fees`) is gone as of
 * [8.14.17]: `_staff.tsx`'s `RequirePermission` now refuses this route in
 * place before this component ever mounts, using
 * `STAFF_ROUTE_PERMISSIONS['/_staff/fees/generate']` = `FEE_GENERATE`
 * (`route-permissions.ts`), and escapes to `/` — the app's role-aware
 * redirect — rather than the sibling `/fees` route this file used to
 * navigate to (see the plan's correction: `/fees` itself needs
 * `FEE_STRUCTURE_READ`, which a `TEACHER` also lacks, so bouncing there
 * only traded one refusal for another).
 */
const generateFeesSearchSchema = z.object({
  step: z.string().optional().catch(undefined),
});

export const Route = createFileRoute('/_staff/fees/generate')({
  validateSearch: generateFeesSearchSchema,
  component: GenerateFeesPage,
});

function GenerateFeesPage() {
  // No ambient `RegionConfigProvider` above the route tree — same
  // reasoning `payments/record.tsx` gives. The academic year's date range
  // is formatted with the tenant's own date settings, which would
  // silently fall back to the provider's hardcoded default without this.
  const regionConfig = useTenantRegionConfig();

  return (
    <RegionConfigProvider value={regionConfig}>
      <GenerateFeesWizard />
    </RegionConfigProvider>
  );
}

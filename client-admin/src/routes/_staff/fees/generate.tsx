import { RoutePending } from '@biddaloy/ui/components';
import { RegionConfigProvider, useTenantRegionConfig, useTranslation } from '@biddaloy/ui/i18n';
import { createFileRoute, useNavigate } from '@tanstack/react-router';

import { loadRouteNamespaces } from '../../../route-loaders';

import { GenerateFeesModal } from './-generate/generate-fees-modal';

/**
 * `/fees/generate` — [16.3.6] replaced the multi-step wizard with a
 * single `GenerateFeesModal` dialog. The route still owns the URL (so
 * "Generate fees" links/buttons elsewhere in the app keep working
 * unchanged) but now just opens the dialog on mount and navigates back to
 * `/fees` when it closes, instead of rendering a full-page wizard.
 *
 * Its own inline permission gate is gone as of [8.14.17]: `_staff.tsx`'s
 * `RequirePermission` refuses this route in place before this component
 * ever mounts, using `STAFF_ROUTE_PERMISSIONS['/_staff/fees/generate']` =
 * `FEE_GENERATE` (`route-permissions.ts`).
 */
export const Route = createFileRoute('/_staff/fees/generate')({
  loader: () => loadRouteNamespaces('feeGeneration'),
  pendingComponent: GenerateFeesPending,
  component: GenerateFeesPage,
});

function GenerateFeesPage() {
  // No ambient `RegionConfigProvider` above the route tree — same
  // reasoning `payments/record.tsx` gives. The academic year's date range
  // is formatted with the tenant's own date settings, which would
  // silently fall back to the provider's hardcoded default without this.
  const regionConfig = useTenantRegionConfig();
  const navigate = useNavigate();

  return (
    <RegionConfigProvider value={regionConfig}>
      <GenerateFeesModal
        open
        onOpenChange={(open) => {
          if (!open) void navigate({ to: '/fees' });
        }}
      />
    </RegionConfigProvider>
  );
}

function GenerateFeesPending() {
  const { t } = useTranslation('nav');
  return <RoutePending variant="form" label={t('routePending.label', { ns: 'nav' })} />;
}

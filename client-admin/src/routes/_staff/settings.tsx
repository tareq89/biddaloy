import { RoutePending } from '@biddaloy/ui/components';
import { RegionConfigProvider, useTenantRegionConfig, useTranslation } from '@biddaloy/ui/i18n';
import { createFileRoute } from '@tanstack/react-router';

import { SchoolSettingsPage } from '../../pages/SchoolSettingsPage';
import { loadRouteNamespaces } from '../../route-loaders';

/**
 * `/settings` — [8.7.13]'s settings page. Its own inline permission gate
 * (`useHasPermission(SETTINGS_MANAGE)`, an early-return `<h1>`) is gone
 * as of [8.14.17]: `_staff.tsx`'s `RequirePermission` now refuses this
 * route in place before this component ever mounts, using the same
 * `STAFF_ROUTE_PERMISSIONS['/_staff/settings']` = `SETTINGS_MANAGE`
 * entry this file used to check itself. See `route-permissions.ts`.
 */
export const Route = createFileRoute('/_staff/settings')({
  // [8.14.5]: i18n-only — see the plan's "plan correction 5". This
  // route's data comes from `useSchoolSettings(schoolId)`, but `schoolId`
  // is picked client-side from `useSchools()` (a SUPER_ADMIN's school
  // picker), not a route param, so there's nothing this `loader` can
  // `ensureQueryData` ahead of time.
  loader: () => loadRouteNamespaces('settings'),
  pendingComponent: SettingsPending,
  component: SettingsRoute,
});

function SettingsRoute() {
  const regionConfig = useTenantRegionConfig();

  return (
    <RegionConfigProvider value={regionConfig}>
      <SchoolSettingsPage />
    </RegionConfigProvider>
  );
}

function SettingsPending() {
  const { t } = useTranslation('nav');
  return <RoutePending variant="form" label={t('routePending.label', { ns: 'nav' })} />;
}

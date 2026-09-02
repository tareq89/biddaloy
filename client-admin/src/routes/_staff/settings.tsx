import { RegionConfigProvider, useTenantRegionConfig } from '@biddaloy/ui/i18n';
import { createFileRoute } from '@tanstack/react-router';

import { SchoolSettingsPage } from '../../pages/SchoolSettingsPage';

/**
 * `/settings` — [8.7.13]'s settings page. Its own inline permission gate
 * (`useHasPermission(SETTINGS_MANAGE)`, an early-return `<h1>`) is gone
 * as of [8.14.17]: `_staff.tsx`'s `RequirePermission` now refuses this
 * route in place before this component ever mounts, using the same
 * `STAFF_ROUTE_PERMISSIONS['/_staff/settings']` = `SETTINGS_MANAGE`
 * entry this file used to check itself. See `route-permissions.ts`.
 */
export const Route = createFileRoute('/_staff/settings')({
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

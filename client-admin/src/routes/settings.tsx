import { Permission } from '@biddaloy/shared';
import { useHasPermission } from '@biddaloy/ui/hooks';
import { RegionConfigProvider, useTenantRegionConfig, useTranslation } from '@biddaloy/ui/i18n';
import { createFileRoute } from '@tanstack/react-router';

import { SchoolSettingsPage } from '../pages/SchoolSettingsPage';

/**
 * `/settings` — carries forward [8.7.13]'s permission gate exactly
 * (`App.tsx`'s own comment already promised "a real router/nav can
 * replace this function's body wholesale without anything under `pages/`
 * changing" — this route is that replacement). The gate stays inline
 * rather than becoming a `beforeLoad` redirect: the existing UX (an
 * inline "you don't have access" message, not a bounce to `/forbidden`)
 * is what [8.9.6] ("see only what my role permits") is scoped to revisit,
 * not this ticket.
 */
export const Route = createFileRoute('/settings')({
  component: SettingsRoute,
});

function SettingsRoute() {
  const { t } = useTranslation('settings');
  const canManageSettings = useHasPermission(Permission.SETTINGS_MANAGE);
  const regionConfig = useTenantRegionConfig();

  if (!canManageSettings) {
    return (
      <div className="flex min-h-[50vh] items-center justify-center p-8">
        <p className="text-muted-foreground">{t('accessDenied')}</p>
      </div>
    );
  }

  return (
    <RegionConfigProvider value={regionConfig}>
      <SchoolSettingsPage />
    </RegionConfigProvider>
  );
}

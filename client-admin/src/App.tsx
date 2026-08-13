import { Permission } from '@biddaloy/shared';
import { useHasPermission } from '@biddaloy/ui/hooks';
import { useTranslation } from '@biddaloy/ui/i18n';

import { SchoolSettingsPage } from './pages/SchoolSettingsPage';

/**
 * #8.7.13's minimal reachability scaffolding — deliberately not a real
 * router/nav shell. This app has neither yet (no `RouterProvider`, no
 * login screen: see `main.tsx`'s own comment and this repo's `ui/README.md`
 * "Testing" section on why), and building either as a side effect of one
 * settings page would preempt whatever a dedicated routing/nav ticket
 * ends up designing. This is the smallest amount of "the Settings screen
 * is reachable and hidden from anyone without SETTINGS_MANAGE" that's
 * true without inventing that infrastructure — a permission check gating
 * which single screen renders. A real router/nav can replace this
 * function's body wholesale without anything under `pages/` changing.
 */
export default function App() {
  const { t } = useTranslation('settings');
  const canManageSettings = useHasPermission(Permission.SETTINGS_MANAGE);

  if (!canManageSettings) {
    return (
      <div className="flex min-h-screen items-center justify-center p-8">
        <p className="text-muted-foreground">{t('accessDenied')}</p>
      </div>
    );
  }

  return <SchoolSettingsPage />;
}

import { getActiveTenant } from '@biddaloy/ui/api';
import { RoutePending } from '@biddaloy/ui/components';
import { useTranslation } from '@biddaloy/ui/i18n';
import { createFileRoute } from '@tanstack/react-router';

import { CurriculumPresetPage } from '../../pages/curriculum-preset/CurriculumPresetPage';
import { loadRouteNamespaces } from '../../route-loaders';

/**
 * [35.5.1] `/curriculum-preset` — Settings › Curriculum preset. Gated by
 * `_staff.tsx`'s `RequirePermission` via `STAFF_ROUTE_PERMISSIONS`
 * (`CURRICULUM_PRESET_APPLY`); the page itself does not self-gate.
 */
export const Route = createFileRoute('/_staff/curriculum-preset')({
  loader: () => loadRouteNamespaces('curriculumPreset', 'presetWarning', 'presetReset'),
  pendingComponent: CurriculumPresetPending,
  component: CurriculumPresetRoute,
});

function CurriculumPresetRoute() {
  const schoolId = getActiveTenant();
  // ponytail: a SUPER_ADMIN with no active tenant sees nothing; the platform
  // school detail page is their entry point.
  return schoolId ? <CurriculumPresetPage schoolId={schoolId} /> : null;
}

function CurriculumPresetPending() {
  const { t } = useTranslation('nav');
  return <RoutePending variant="form" label={t('routePending.label', { ns: 'nav' })} />;
}

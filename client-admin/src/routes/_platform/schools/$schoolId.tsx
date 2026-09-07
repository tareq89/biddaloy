import { useTranslation } from '@biddaloy/ui/i18n';
import { createFileRoute } from '@tanstack/react-router';

import { loadRouteNamespaces } from '../../../route-loaders';

/**
 * Placeholder only — #535 (15.4.10) replaces this with the real school
 * detail page (stats from `GET /schools/:id/stats`, status
 * suspend/reactivate via `PATCH /schools/:id/status`, admin
 * recovery). This route exists purely so `/schools/$schoolId` resolves
 * instead of 404ing when #533's list page links a row to it.
 */
export const Route = createFileRoute('/_platform/schools/$schoolId')({
  loader: () => loadRouteNamespaces('platform'),
  component: SchoolDetailPlaceholder,
});

function SchoolDetailPlaceholder() {
  const { t } = useTranslation('platform');
  const { schoolId } = Route.useParams();
  return (
    <div className="flex flex-col gap-2">
      <h1 className="text-lg font-semibold">{t('schoolDetail.title')}</h1>
      <p className="text-sm text-muted-foreground">{t('schoolDetail.comingSoon', { schoolId })}</p>
    </div>
  );
}

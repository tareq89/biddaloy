import { RoutePending } from '@biddaloy/ui/components';
import { RegionConfigProvider, useTenantRegionConfig, useTranslation } from '@biddaloy/ui/i18n';
import { useCloseFullPage } from '@biddaloy/ui/shells';
import { createFileRoute } from '@tanstack/react-router';
import { z } from 'zod';

import { loadRouteNamespaces } from '../../../route-loaders';

import { RecordPaymentModal } from './-record/record-payment-modal';

/**
 * `/payments/record` — [31.4] the Record Payment form as a full page
 * (`FullPageShell`, D22). `RecordPaymentModal` keeps its name and props so
 * the fees dues page (another lane) keeps mounting it unchanged; here it is
 * always open and Close / Esc / Cancel go back (or to `/payments` on a deep link).
 *
 * `student_id` / `guardian_id` deep-link a student or a guardian's children.
 */
const recordPaymentSearchSchema = z.object({
  student_id: z.string().min(1).optional().catch(undefined),
  guardian_id: z.string().min(1).optional().catch(undefined),
});

export const Route = createFileRoute('/_staff/payments/record')({
  validateSearch: recordPaymentSearchSchema,
  staticData: { chromeless: true },
  loader: () => loadRouteNamespaces('payments', 'common', 'fees'),
  pendingComponent: RecordPaymentPending,
  component: RecordPaymentPage,
});

function RecordPaymentPage() {
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  const regionConfig = useTenantRegionConfig();
  const close = useCloseFullPage(() => void navigate({ to: '/payments' }));
  return (
    <RegionConfigProvider value={regionConfig}>
      <RecordPaymentModal
        open
        onOpenChange={(open) => {
          if (!open) close();
        }}
        {...(search.student_id !== undefined ? { studentId: search.student_id } : {})}
        {...(search.guardian_id !== undefined ? { guardianId: search.guardian_id } : {})}
      />
    </RegionConfigProvider>
  );
}

function RecordPaymentPending() {
  const { t } = useTranslation('nav');
  return <RoutePending variant="form" label={t('routePending.label', { ns: 'nav' })} />;
}

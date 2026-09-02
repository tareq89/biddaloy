import { RoutePending } from '@biddaloy/ui/components';
import { RegionConfigProvider, useTenantRegionConfig, useTranslation } from '@biddaloy/ui/i18n';
import { createFileRoute } from '@tanstack/react-router';
import { z } from 'zod';

import { loadRouteNamespaces } from '../../../route-loaders';

import { RecordPaymentWizard } from './-record/record-payment-wizard';

/**
 * `/payments/record` — [8.10.5]'s Record Payment wizard. `student_id` was
 * declared and read here since [8.10.1] wired the students list's
 * "Collect fees" row action to deep-link into this route before this
 * ticket built a real destination for it; `step` is `WizardShell`'s own
 * `useWizardShellStep` contract (`?step=` as the source of truth for the
 * active step, so it survives a refresh).
 */
const recordPaymentSearchSchema = z.object({
  student_id: z.string().min(1).optional().catch(undefined),
  step: z.string().optional().catch(undefined),
});

export const Route = createFileRoute('/_staff/payments/record')({
  validateSearch: recordPaymentSearchSchema,
  loader: () => loadRouteNamespaces('payments', 'common'),
  pendingComponent: RecordPaymentPending,
  component: RecordPaymentPage,
});

function RecordPaymentPage() {
  const { student_id } = Route.useSearch();
  // `useRegionConfig()` has no ambient provider above the route tree
  // (same reasoning `students/$studentId.tsx`'s own `RegionConfigProvider`
  // wrap gives) — every amount on this page (`MoneyInput`, the running
  // total, the receipt) would silently fall back to the provider's
  // hardcoded default region rather than the active tenant's actual one
  // without this.
  const regionConfig = useTenantRegionConfig();
  return (
    <RegionConfigProvider value={regionConfig}>
      {/* `exactOptionalPropertyTypes` — omit rather than set `undefined`. */}
      <RecordPaymentWizard
        {...(student_id !== undefined ? { initialStudentId: student_id } : {})}
      />
    </RegionConfigProvider>
  );
}

function RecordPaymentPending() {
  const { t } = useTranslation('nav');
  return <RoutePending variant="form" label={t('routePending.label', { ns: 'nav' })} />;
}

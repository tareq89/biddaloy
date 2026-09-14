/**
 * `/payments` — [16.4.4]'s minimal placeholder. This ticket only needs a
 * page to open the Record Payment modal from and land the redirect from
 * `/payments/record` on; it is **not** a payments list. The real list
 * (table, filters, search, detail drawer) is a later client ticket over
 * #660's list/detail server endpoints — do not grow this file into that
 * without a plan for it, the same way `fees/index.tsx` documents itself
 * as a placeholder for a later feature-module ticket.
 */
import { Permission } from '@biddaloy/shared';
import { Button, EmptyState, RoutePending } from '@biddaloy/ui/components';
import { useHasPermission } from '@biddaloy/ui/hooks';
import { RegionConfigProvider, useTenantRegionConfig, useTranslation } from '@biddaloy/ui/i18n';
import { createFileRoute } from '@tanstack/react-router';
import { z } from 'zod';

import { loadRouteNamespaces } from '../../../route-loaders';

import { RecordPaymentModal } from './-record/record-payment-modal';

const paymentsSearchSchema = z.object({
  // `'1'` opens the modal. `z.coerce.string()`, not `z.string()` — the
  // router's default search parser coerces a numeric-looking query value
  // (`?record=1`) to the *number* `1`, not the string `'1'`, before this
  // schema ever sees it; a plain `z.string()` would fail that and
  // silently fall back to `undefined` via `.catch()`.
  record: z.coerce.string().optional().catch(undefined),
  student_id: z.string().min(1).optional().catch(undefined),
  guardian_id: z.string().min(1).optional().catch(undefined),
});

export const Route = createFileRoute('/_staff/payments/')({
  validateSearch: paymentsSearchSchema,
  loader: () => loadRouteNamespaces('payments', 'common'),
  pendingComponent: PaymentsPending,
  component: PaymentsPage,
});

function PaymentsPage() {
  const { t } = useTranslation('payments');
  const navigate = Route.useNavigate();
  const search = Route.useSearch();
  const canRecord = useHasPermission(Permission.PAYMENT_RECORD);
  // No ambient `RegionConfigProvider` above the route tree — every amount
  // the modal renders (`MoneyInput`, the cart, the tender section) would
  // otherwise fall back to the provider's hardcoded default region
  // instead of the active tenant's, same reasoning `record.tsx` gave.
  const regionConfig = useTenantRegionConfig();

  function setModalOpen(open: boolean) {
    void navigate({
      search: (prev) =>
        open
          ? { ...prev, record: '1' }
          : {
              ...prev,
              record: undefined,
              student_id: undefined,
              guardian_id: undefined,
            },
    });
  }

  return (
    <RegionConfigProvider value={regionConfig}>
      <div className="flex flex-col gap-4">
        <div className="flex items-center justify-between">
          <h1 className="text-lg font-semibold">{t('title')}</h1>
          {canRecord && (
            <Button type="button" onClick={() => setModalOpen(true)}>
              {t('recordAction')}
            </Button>
          )}
        </div>
        <EmptyState
          title={t('title')}
          explanation={t('explanation')}
          action={{ label: t('recordAction'), onClick: () => setModalOpen(true) }}
        />
        <RecordPaymentModal
          open={search.record === '1'}
          onOpenChange={setModalOpen}
          {...(search.student_id !== undefined ? { studentId: search.student_id } : {})}
          {...(search.guardian_id !== undefined ? { guardianId: search.guardian_id } : {})}
        />
      </div>
    </RegionConfigProvider>
  );
}

function PaymentsPending() {
  const { t } = useTranslation('nav');
  return <RoutePending variant="list" label={t('routePending.label', { ns: 'nav' })} />;
}

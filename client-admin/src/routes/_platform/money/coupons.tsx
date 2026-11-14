import { usePlatformCoupons, useUpdateCoupon, type PlatformCoupon } from '@biddaloy/ui/hooks';
import { createFileRoute, useNavigate } from '@tanstack/react-router';
import * as React from 'react';
import { z } from 'zod';

import { CouponDialog } from '../../../features/cockpit/money/coupons/coupon-dialog';
import { CouponListView } from '../../../features/cockpit/money/coupons/coupon-list-view';
import { CouponUsage } from '../../../features/cockpit/money/coupons/coupon-usage';
import { loadRouteNamespaces } from '../../../route-loaders';

/** [100.5.gI-07] Coupons tab: list, new (also `?new=1` from the palette), edit, usage, on/off. */
export const Route = createFileRoute('/_platform/money/coupons')({
  // The router parses `?new=1` as the number 1.
  validateSearch: z.object({
    new: z
      .union([z.literal(1), z.literal('1')])
      .optional()
      .catch(undefined),
  }),
  loader: () => loadRouteNamespaces('moneyCoupons'),
  component: CouponsPage,
});

function CouponsPage() {
  const search = Route.useSearch();
  const navigate = useNavigate();
  const query = usePlatformCoupons();
  const update = useUpdateCoupon();
  const [creating, setCreating] = React.useState(search.new !== undefined);
  const [editing, setEditing] = React.useState<PlatformCoupon | undefined>();
  const [usageFor, setUsageFor] = React.useState<PlatformCoupon | undefined>();

  // The palette link opens the dialog once, then the URL goes back to the plain tab.
  React.useEffect(() => {
    if (search.new !== undefined) {
      setCreating(true);
      void navigate({ to: '/money/coupons', search: {}, replace: true });
    }
  }, [search.new, navigate]);

  return (
    <>
      <CouponListView
        coupons={query.data?.items ?? []}
        loading={query.isLoading}
        error={query.isError}
        onRetry={() => void query.refetch()}
        onNew={() => setCreating(true)}
        onEdit={setEditing}
        onUsage={setUsageFor}
        onToggle={(coupon, active) => update.mutate({ id: coupon.id, active })}
        busyId={update.isPending ? update.variables?.id : undefined}
        switchError={update.isError}
      />
      <CouponDialog
        open={creating || editing !== undefined}
        coupon={editing}
        onOpenApprovals={() =>
          void navigate({ to: '/platform-owners', search: { tab: 'approvals' } })
        }
        onOpenChange={(next) => {
          if (!next) {
            setCreating(false);
            setEditing(undefined);
          }
        }}
      />
      <CouponUsage
        coupon={usageFor}
        onOpenChange={(next) => {
          if (!next) setUsageFor(undefined);
        }}
      />
    </>
  );
}

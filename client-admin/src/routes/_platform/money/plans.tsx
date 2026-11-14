import { usePlatformPlans, useUpdatePlan, type PlatformPlan } from '@biddaloy/ui/hooks';
import { createFileRoute } from '@tanstack/react-router';
import * as React from 'react';

import { PlanDialog } from '../../../features/cockpit/money/plans/plan-dialog';
import { PlanListView } from '../../../features/cockpit/money/plans/plan-list-view';
import { loadRouteNamespaces } from '../../../route-loaders';

/** [100.5.gI-06] Plans tab: per-seat price, on/off, new and edit. */
export const Route = createFileRoute('/_platform/money/plans')({
  loader: () => loadRouteNamespaces('moneyPlans'),
  component: PlansPage,
});

function PlansPage() {
  const query = usePlatformPlans();
  const update = useUpdatePlan();
  const [creating, setCreating] = React.useState(false);
  const [editing, setEditing] = React.useState<PlatformPlan | undefined>();

  return (
    <>
      <PlanListView
        plans={query.data ?? []}
        loading={query.isLoading}
        error={query.isError}
        onRetry={() => void query.refetch()}
        onNew={() => setCreating(true)}
        onEdit={setEditing}
        onToggle={(plan, active) => update.mutate({ id: plan.id, active })}
        busyId={update.isPending ? update.variables?.id : undefined}
        switchError={update.isError}
      />
      <PlanDialog
        open={creating || editing !== undefined}
        plan={editing}
        onOpenChange={(next) => {
          if (!next) {
            setCreating(false);
            setEditing(undefined);
          }
        }}
      />
    </>
  );
}

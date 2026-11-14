import {
  usePlatformSmsPackages,
  useSetSmsPackageActive,
  type SmsPackage,
} from '@biddaloy/ui/hooks';
import { createFileRoute, useNavigate } from '@tanstack/react-router';
import * as React from 'react';
import { z } from 'zod';

import { PackageDialog } from '../../../features/cockpit/money/packages/package-dialog';
import { PackageListView } from '../../../features/cockpit/money/packages/package-list-view';
import { loadRouteNamespaces } from '../../../route-loaders';

/** [100.5.gI-05] SMS packages tab. `?new=1` opens the new-package dialog (palette `sms-bundle.new`). */
export const Route = createFileRoute('/_platform/money/packages')({
  validateSearch: z.object({
    new: z
      .union([z.literal(1), z.literal('1')])
      .optional()
      .catch(undefined),
  }),
  loader: () => loadRouteNamespaces('moneyPackages'),
  component: PackagesPage,
});

function PackagesPage() {
  const navigate = useNavigate();
  const wantsNew = Route.useSearch().new;
  const query = usePlatformSmsPackages();
  const setActive = useSetSmsPackageActive();
  const [creating, setCreating] = React.useState(false);
  const [editing, setEditing] = React.useState<SmsPackage | undefined>();

  React.useEffect(() => {
    if (String(wantsNew) === '1') setCreating(true);
  }, [wantsNew]);

  function closeDialog() {
    setCreating(false);
    setEditing(undefined);
    if (wantsNew !== undefined) {
      void navigate({ to: '.', search: { new: undefined }, replace: true });
    }
  }

  return (
    <>
      <PackageListView
        packages={query.data ?? []}
        loading={query.isLoading}
        error={query.isError}
        onRetry={() => void query.refetch()}
        onNew={() => setCreating(true)}
        onRecordStock={() => void navigate({ to: '/money', search: { record: 1 } })}
        onEdit={setEditing}
        onToggle={(pkg, active) => setActive.mutate({ id: pkg.id, active })}
        busyId={setActive.isPending ? setActive.variables?.id : undefined}
        switchError={setActive.isError}
      />
      <PackageDialog
        open={creating || editing !== undefined}
        pkg={editing}
        onOpenChange={(next) => !next && closeDialog()}
      />
    </>
  );
}

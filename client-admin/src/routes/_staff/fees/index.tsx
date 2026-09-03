import { Permission } from '@biddaloy/shared';
import { Card, RoutePending } from '@biddaloy/ui/components';
import { useHasPermission } from '@biddaloy/ui/hooks';
import { useTranslation } from '@biddaloy/ui/i18n';
import { createFileRoute, Link } from '@tanstack/react-router';
import { ChevronRightIcon } from 'lucide-react';

import { loadRouteNamespaces } from '../../../route-loaders';

/**
 * [8.14.13]: `/fees` was a dead end — its only content was an
 * `EmptyState` whose single action bounced to `/settings`, a page with
 * nothing fee-related on it. This is a small hub instead: one card per
 * fee-related destination the viewer's role can actually open, cloning
 * the `Card asChild><Link …>` grammar from `portal/index.tsx`'s
 * `ChildCard` verbatim (whole-card tap target, `ChevronRightIcon` as the
 * only affordance, no separate "view" link nested inside).
 *
 * `client-admin/src/routes/_staff.tsx`'s own `/fees` nav entry is
 * *not* touched by this ticket — it stays gated on
 * `FEE_STRUCTURE_READ` and still points at `/fees`, it just no longer
 * dead-ends once you land here. `/fees/dues` and `/payments/record` are
 * separately pinned Finance-group nav items with their own gates
 * (`FEE_COLLECT` / `PAYMENT_RECORD`); this hub duplicates the `/fees/dues`
 * link as one of its cards on purpose, so a viewer who *only* has
 * `FEE_STRUCTURE_READ` (not a pinned nav item) still finds it from here.
 *
 * No "no access" empty state: `route-permissions.ts` already maps
 * `/_staff/fees/` to `Permission.FEE_STRUCTURE_READ`, and `_staff.tsx`'s
 * `RequirePermission` refuses the route (rendering `AccessDeniedState`
 * in place of the whole `<Outlet />`, this component included) before
 * `FeesPage` ever mounts for a role that lacks it. So every role that
 * reaches this component already holds `FEE_STRUCTURE_READ`, and the
 * "fee structures" card below is unconditionally visible — `cards`
 * can never be empty. (Divergence from [8.14.13]'s plan, which assumed
 * a `FEE_READ`-only role could still reach this page and need a
 * dedicated no-access state; it can't, because the route-level gate
 * already covers that case.)
 */
export const Route = createFileRoute('/_staff/fees/')({
  // No data query — the hub itself renders no server-backed content,
  // only permission-gated links to pages that fetch their own.
  loader: () => loadRouteNamespaces('fees'),
  pendingComponent: FeesPending,
  component: FeesPage,
});

interface FeesHubCard {
  key: 'dues' | 'generate' | 'feeStructures' | 'invoices';
  to: '/fees/dues' | '/fees/generate' | '/fee-structures' | '/invoices';
  permission: Permission;
}

const CARDS: FeesHubCard[] = [
  { key: 'dues', to: '/fees/dues', permission: Permission.FEE_COLLECT },
  { key: 'generate', to: '/fees/generate', permission: Permission.FEE_GENERATE },
  { key: 'feeStructures', to: '/fee-structures', permission: Permission.FEE_STRUCTURE_READ },
  { key: 'invoices', to: '/invoices', permission: Permission.INVOICE_READ },
];

function FeesPage() {
  const { t } = useTranslation('fees');

  const canCollect = useHasPermission(Permission.FEE_COLLECT);
  const canGenerate = useHasPermission(Permission.FEE_GENERATE);
  const canReadStructures = useHasPermission(Permission.FEE_STRUCTURE_READ);
  const canReadInvoices = useHasPermission(Permission.INVOICE_READ);
  const permitted: Record<Permission, boolean> = {
    [Permission.FEE_COLLECT]: canCollect,
    [Permission.FEE_GENERATE]: canGenerate,
    [Permission.FEE_STRUCTURE_READ]: canReadStructures,
    [Permission.INVOICE_READ]: canReadInvoices,
  } as Record<Permission, boolean>;

  const cards = CARDS.filter((card) => permitted[card.permission]);

  return (
    <div className="flex max-w-2xl flex-col gap-3">
      <h1 className="text-sm font-normal text-muted-foreground">{t('hub.title')}</h1>
      <p className="text-xs text-muted-foreground">{t('hub.explanation')}</p>

      {cards.map((card) => (
        <Card asChild key={card.key}>
          <Link
            to={card.to}
            className="flex items-center justify-between gap-2 p-3.5 no-underline hover:shadow-e2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring"
          >
            <div className="flex flex-col gap-0.5">
              <span className="text-sm font-semibold">{t(`hub.cards.${card.key}.title`)}</span>
              <span className="text-xs text-muted-foreground">
                {t(`hub.cards.${card.key}.description`)}
              </span>
            </div>
            <ChevronRightIcon
              className="size-4 shrink-0 text-muted-foreground"
              aria-hidden="true"
            />
          </Link>
        </Card>
      ))}
    </div>
  );
}

function FeesPending() {
  const { t } = useTranslation('nav');
  return <RoutePending variant="list" label={t('routePending.label', { ns: 'nav' })} />;
}

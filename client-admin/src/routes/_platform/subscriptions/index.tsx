import { SCHOOL_BILLING_FILTERS } from '@biddaloy/shared';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@biddaloy/ui/components';
import {
  PLATFORM_BILLING_PAGE_SIZE,
  usePlatformSchoolBilling,
  type PlatformSchoolBilling,
} from '@biddaloy/ui/hooks';
import { useTranslation } from '@biddaloy/ui/i18n';
import { createFileRoute, useNavigate } from '@tanstack/react-router';
import * as React from 'react';
import { z } from 'zod';

import { loadRouteNamespaces } from '../../../route-loaders';

import { SchoolBilling } from './-detail/school-billing';
import { SubscriptionsListView } from './-subscriptions-list-view';

/**
 * Epic 49 W4: the platform SUPER_ADMIN's view of every school's seats, orders and payments.
 * The filter is URL-backed (`?filter=expiring`); opening a row shows its orders in a dialog with
 * Record payment, Grant seats and Revive. The server is the security boundary
 * (`PlatformSuperAdminGuard`); `RequireRole` in `_platform/route.tsx` is UX only.
 */
const searchSchema = z.object({
  filter: z.enum(SCHOOL_BILLING_FILTERS).optional().catch(undefined),
});

export const Route = createFileRoute('/_platform/subscriptions/')({
  validateSearch: searchSchema,
  loader: () => loadRouteNamespaces('platform'),
  component: SubscriptionsPage,
});

function SubscriptionsPage() {
  const { t } = useTranslation('platform');
  const navigate = useNavigate();
  const { filter } = Route.useSearch();
  const [search, setSearch] = React.useState('');
  const [open, setOpen] = React.useState<PlatformSchoolBilling | null>(null);
  const [page, setPage] = React.useState(1);
  const [debounced, setDebounced] = React.useState('');
  React.useEffect(() => {
    const id = setTimeout(() => setDebounced(search.trim()), 250);
    return () => clearTimeout(id);
  }, [search]);

  const query = usePlatformSchoolBilling({
    ...(debounced ? { search: debounced } : {}),
    ...(filter ? { filter } : {}),
    page,
  });

  return (
    <>
      <SubscriptionsListView
        schools={query.data?.items ?? []}
        total={query.data?.total ?? 0}
        page={page}
        pageSize={PLATFORM_BILLING_PAGE_SIZE}
        onPageChange={setPage}
        loading={query.isLoading}
        isFetching={query.isFetching}
        {...(query.isError ? { error: t('subscriptions.errorMessage') } : {})}
        search={search}
        onSearchChange={(v) => {
          setSearch(v);
          setPage(1);
        }}
        filter={filter}
        onFilterChange={(next) => {
          setPage(1);
          void navigate({
            to: '/subscriptions',
            search: next ? { filter: next } : {},
            replace: true,
          });
        }}
        onOpen={setOpen}
      />
      <Dialog open={open !== null} onOpenChange={(next) => !next && setOpen(null)}>
        <DialogContent size="lg">
          <DialogHeader>
            <DialogTitle>{open?.name}</DialogTitle>
            <DialogDescription>{t('subscriptions.panel.title')}</DialogDescription>
          </DialogHeader>
          {open && <SchoolBilling schoolId={open.id} schoolName={open.name} />}
        </DialogContent>
      </Dialog>
    </>
  );
}

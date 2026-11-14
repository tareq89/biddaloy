import { downloadRevenueCsv, usePlatformRevenue, type NotRenewedRow } from '@biddaloy/ui/hooks';
import { toIsoDate } from '@biddaloy/ui/utils';
import { createFileRoute } from '@tanstack/react-router';
import * as React from 'react';

import { RevenueView } from '../../../features/cockpit/money/revenue/revenue-view';
import { VatDialog } from '../../../features/cockpit/money/revenue/vat-dialog';
import { loadRouteNamespaces } from '../../../route-loaders';

const thisMonth = () => toIsoDate(new Date()).slice(0, 7);

/** [100.5.gJ-01] Revenue tab. The month is the URL's `month` (`YYYY-MM`, default this month). */
export const Route = createFileRoute('/_platform/money/revenue')({
  validateSearch: (search: Record<string, unknown>): { month?: string } =>
    typeof search.month === 'string' && /^\d{4}-(0[1-9]|1[0-2])$/.test(search.month)
      ? { month: search.month }
      : {},
  loader: () => loadRouteNamespaces('moneyRevenue'),
  component: RevenuePage,
});

function RevenuePage() {
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  const month = search.month ?? thisMonth();
  const [cursor, setCursor] = React.useState<string | undefined>();
  const [earlier, setEarlier] = React.useState<NotRenewedRow[]>([]);
  const query = usePlatformRevenue(cursor ? { month, cursor } : { month });
  // A new month starts the list again.
  React.useEffect(() => {
    setCursor(undefined);
    setEarlier([]);
  }, [month]);
  const report = query.data && {
    ...query.data,
    not_renewed: {
      ...query.data.not_renewed,
      // ponytail: de-duplicated by school while the next page loads (keepPreviousData).
      items: [
        ...new Map(
          [...earlier, ...query.data.not_renewed.items].map((r) => [r.school_id, r]),
        ).values(),
      ],
    },
  };
  const [vatOpen, setVatOpen] = React.useState(false);
  const [csvError, setCsvError] = React.useState(false);

  return (
    <>
      <RevenueView
        month={month}
        onMonthChange={(next) => void navigate({ search: { month: next } })}
        report={report}
        onMore={() => {
          setEarlier(report?.not_renewed.items ?? []);
          setCursor(query.data?.not_renewed.next_cursor ?? undefined);
        }}
        hasMore={Boolean(query.data?.not_renewed.next_cursor)}
        loadingMore={query.isFetching && !query.isLoading}
        loading={query.isLoading}
        error={query.isError}
        onRetry={() => void query.refetch()}
        onCsv={() => {
          setCsvError(false);
          downloadRevenueCsv(month).catch(() => setCsvError(true));
        }}
        csvError={csvError}
        onVat={() => setVatOpen(true)}
      />
      <VatDialog open={vatOpen} onOpenChange={setVatOpen} />
    </>
  );
}

import { useQuery } from '@tanstack/react-query';

import { getAlertsReport, getAlertsReportCsv, type AlertsReportFilters } from '../../api/attention';
import { createEntityKeys } from '../query-keys';
import { shouldRetryQuery } from '../retry';

export const alertsReportKeys = createEntityKeys<AlertsReportFilters>('attention-report');

export function useAlertsReport(filters: AlertsReportFilters) {
  return useQuery({
    queryKey: alertsReportKeys.list(filters),
    queryFn: ({ signal }) => getAlertsReport(filters, signal),
    enabled: Boolean(filters.month),
    retry: shouldRetryQuery,
  });
}

/** Authenticated blob download (a bare `<a href>` would miss the auth header). */
export async function downloadAlertsReportCsv(filters: AlertsReportFilters): Promise<void> {
  const blob = await getAlertsReportCsv(filters);
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `alerts-report-${filters.month}.csv`;
  anchor.style.display = 'none';
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

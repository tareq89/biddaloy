/** Print history ("Printables & documents") — [32.4.1]. Filters live in the URL. */
import { DocumentKind, PrintSubjectType } from '@biddaloy/shared';
import { useRegionConfig, useTranslation } from '@biddaloy/ui/i18n';
import { createFileRoute } from '@tanstack/react-router';
import * as React from 'react';

import {
  CertificateRegister,
  currentYear,
} from '../../../components/print/history/certificate-register';
import { printHistorySearchSchema } from '../../../components/print/history/print-history-filters';
import { PrintHistoryPage } from '../../../components/print/history/print-history-page';
import {
  PrintablesTabs,
  useActiveTab,
  type PrintablesTab,
} from '../../../components/print/history/printables-tabs';
import { ToPrint } from '../../../components/print/history/to-print';
import { loadRouteNamespaces } from '../../../route-loaders';

export const Route = createFileRoute('/_staff/reports/printables')({
  validateSearch: printHistorySearchSchema,
  loader: () => loadRouteNamespaces('printHistory', 'common'),
  component: PrintablesPage,
});

function PrintablesPage() {
  useTranslation('printHistory');
  const region = useRegionConfig();
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  const tab = useActiveTab(search.tab);
  // The register opens on this year (the mockup's year chip); clearing it afterwards shows every year.
  const defaulted = React.useRef(false);
  React.useEffect(() => {
    if (tab !== 'register') defaulted.current = false;
    else if (!defaulted.current) {
      defaulted.current = true;
      if (search.year === undefined) {
        void navigate({
          search: (prev) => ({ ...prev, year: currentYear(region) }),
          replace: true,
        });
      }
    }
  }, [tab, search.year, navigate, region]);

  const tabs = (
    <PrintablesTabs
      value={tab}
      onChange={(next: PrintablesTab) =>
        // Each tab keeps its own filters: switching starts clean.
        void navigate({ search: { tab: next === 'history' ? undefined : next } })
      }
    />
  );
  const onSearchChange = (patch: Record<string, string | number | null>) =>
    void navigate({
      search: (prev) => {
        const next: Record<string, unknown> = { ...prev };
        for (const [key, value] of Object.entries(patch)) {
          if (value === null) delete next[key];
          else next[key] = value;
        }
        // Any filter change goes back to page 1; only an explicit `page` patch keeps it.
        if (!('page' in patch)) delete next.page;
        return next;
      },
    });
  if (tab === 'to-print') return <ToPrint tabs={tabs} />;
  if (tab === 'register') {
    return <CertificateRegister search={search} onSearchChange={onSearchChange} tabs={tabs} />;
  }
  return (
    <PrintHistoryPage
      tabs={tabs}
      search={search}
      onPrintIdCards={() =>
        void navigate({
          to: '/print/preview',
          search: {
            kind: DocumentKind.STUDENT_ID_CARD,
            subject_type: PrintSubjectType.STUDENT,
            from: '/reports/printables',
          },
        })
      }
      onSearchChange={onSearchChange}
    />
  );
}

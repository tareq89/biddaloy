/** Print history ("Printables & documents") — [32.4.1]. Filters live in the URL. */
import { DocumentKind, PrintSubjectType } from '@biddaloy/shared';
import { useTranslation } from '@biddaloy/ui/i18n';
import { createFileRoute } from '@tanstack/react-router';

import { printHistorySearchSchema } from '../../../components/print/history/print-history-filters';
import { PrintHistoryPage } from '../../../components/print/history/print-history-page';
import { loadRouteNamespaces } from '../../../route-loaders';

export const Route = createFileRoute('/_staff/reports/printables')({
  validateSearch: printHistorySearchSchema,
  loader: () => loadRouteNamespaces('printHistory', 'common'),
  component: PrintablesPage,
});

function PrintablesPage() {
  useTranslation('printHistory');
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  return (
    <PrintHistoryPage
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
      onSearchChange={(patch) =>
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
        })
      }
    />
  );
}

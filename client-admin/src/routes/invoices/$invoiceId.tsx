import { ErrorState, Skeleton } from '@biddaloy/ui/components';
import { useInvoice } from '@biddaloy/ui/hooks';
import { useTranslation } from '@biddaloy/ui/i18n';
import { createFileRoute, Link } from '@tanstack/react-router';

/**
 * `/invoices/$invoiceId` — [8.9.9]'s Cmd/Ctrl+K palette is the only
 * caller today (an invoice result's `onSelect` navigates here); there is
 * no invoices list page yet to link in from, same gap `students/
 * $studentId.tsx`'s own header comment predates for students before
 * [8.9.1]. `GET /invoices/:id` (`invoices.controller.ts`) already
 * existed before this route did — printing (`invoices/:id/print`) has
 * shipped since [#14] — so this is the minimal page needed to give a
 * search result somewhere real to land, not a new backend surface.
 */
export const Route = createFileRoute('/invoices/$invoiceId')({
  component: InvoiceDetailPage,
});

function InvoiceDetailPage() {
  const { invoiceId } = Route.useParams();
  const { t } = useTranslation('fees');
  const invoiceQuery = useInvoice(invoiceId);

  return (
    <div className="flex flex-col gap-4">
      <Link to="/fees" className="text-sm text-primary underline">
        {t('invoiceDetail.back')}
      </Link>
      {invoiceQuery.isPending ? (
        <Skeleton className="h-7 w-48" />
      ) : invoiceQuery.isError ? (
        <ErrorState
          message={t('invoiceDetail.loadError')}
          retryLabel={t('invoiceDetail.retry')}
          onRetry={() => void invoiceQuery.refetch()}
        />
      ) : (
        <h1 className="text-lg font-semibold">{invoiceQuery.data.invoice_number}</h1>
      )}
    </div>
  );
}

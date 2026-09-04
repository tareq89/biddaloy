import { InvoiceStatus, Permission } from '@biddaloy/shared';
import {
  Button,
  ErrorState,
  Field,
  FieldGrid,
  RoutePending,
  Skeleton,
  StatusBadge,
  toast,
} from '@biddaloy/ui/components';
import {
  invoiceQueryOptions,
  openPrintableInvoice,
  useHasPermission,
  useInvoice,
} from '@biddaloy/ui/hooks';
import { useRegionConfig, useTranslation } from '@biddaloy/ui/i18n';
import { formatDate, formatServerAmount, parseServerDate } from '@biddaloy/ui/utils';
import { createFileRoute, Link } from '@tanstack/react-router';

import { loadRouteNamespaces, swallowUnlessOffline } from '../../../route-loaders';

/**
 * `/invoices/$invoiceId` — [8.9.9]'s Cmd/Ctrl+K palette and [8.10.6]'s
 * `/invoices` list both link here. `GET /invoices/:id` (`invoices.
 * controller.ts`) already existed before this route did — printing
 * (`invoices/:id/print`) has shipped since [#14] — so [8.10.6] only
 * fleshes out the fields this page renders, not a new backend surface.
 *
 * `line_items` isn't rendered: the generated `Invoice` schema types the
 * response field `Record<string, never> | null` (jsonb has no OpenAPI
 * shape for Swagger to infer), so reading it here would mean an unsound
 * cast for a field the acceptance criteria don't actually ask for.
 */
export const Route = createFileRoute('/_staff/invoices/$invoiceId')({
  loader: ({ context: { queryClient }, params }) =>
    Promise.all([
      // [8.14.5]: swallowed — see `academic-years/$academicYearId.tsx`'s
      // identical comment for why.
      queryClient
        .ensureQueryData(invoiceQueryOptions(params.invoiceId))
        .catch(swallowUnlessOffline),
      loadRouteNamespaces('fees'),
    ]),
  pendingComponent: InvoiceDetailPending,
  component: InvoiceDetailPage,
});

function InvoiceDetailPage() {
  const { invoiceId } = Route.useParams();
  const { t } = useTranslation('fees');
  const regionConfig = useRegionConfig();
  const invoiceQuery = useInvoice(invoiceId);
  const canPrint = useHasPermission(Permission.INVOICE_PRINT);

  return (
    <div className="flex flex-col gap-4">
      <Link
        to="/invoices"
        className="inline-flex min-h-6 items-center self-start text-sm text-primary underline"
      >
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
        <>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="flex flex-col gap-1">
              <h1 className="text-lg font-semibold">{invoiceQuery.data.invoice_number}</h1>
              <p className="text-sm text-muted-foreground">{invoiceQuery.data.student.full_name}</p>
            </div>
            <StatusBadge domain="invoice" status={invoiceQuery.data.status as InvoiceStatus} />
          </div>

          <FieldGrid className="text-sm">
            <Field label={t('invoiceDetail.issuedDate')}>
              {formatDate(parseServerDate(invoiceQuery.data.issued_date), regionConfig)}
            </Field>
            <Field label={t('invoiceDetail.dueDate')}>
              {formatDate(parseServerDate(invoiceQuery.data.due_date), regionConfig)}
            </Field>
            <Field label={t('invoiceDetail.taxAmount')}>
              {formatServerAmount(invoiceQuery.data.tax_amount, regionConfig)}
            </Field>
            <Field label={t('invoiceDetail.discountAmount')}>
              {formatServerAmount(invoiceQuery.data.discount_amount, regionConfig)}
            </Field>
            <Field label={t('invoiceDetail.totalAmount')}>
              <span className="font-medium">
                {formatServerAmount(invoiceQuery.data.total_amount, regionConfig)}
              </span>
            </Field>
          </FieldGrid>

          {invoiceQuery.data.notes !== null && (
            <p className="text-sm text-muted-foreground">{invoiceQuery.data.notes}</p>
          )}

          {canPrint && (
            <Button
              type="button"
              className="self-start"
              onClick={() =>
                void openPrintableInvoice(invoiceQuery.data.id, () =>
                  toast.error(t('invoiceDetail.printError')),
                )
              }
            >
              {t('invoiceDetail.print')}
            </Button>
          )}
        </>
      )}
    </div>
  );
}

function InvoiceDetailPending() {
  const { t } = useTranslation('nav');
  return <RoutePending variant="detail" label={t('routePending.label', { ns: 'nav' })} />;
}

import { captureNotificationTenant, notifyOutcome } from '@biddaloy/ui/api';
import {
  Button,
  BulkUploadPreview,
  Card,
  ConfirmDialog,
  RoutePending,
  StatusBadge,
  type BulkUploadPreviewController,
} from '@biddaloy/ui/components';
import {
  useCommitHomeworkUpload,
  useValidateHomeworkUpload,
  type HomeworkUploadResult,
  type HomeworkUploadSummary,
} from '@biddaloy/ui/hooks';
import type { PreviewResult } from '@biddaloy/ui/hooks';
import {
  RegionConfigProvider,
  useRegionConfig,
  useTenantRegionConfig,
  useTranslation,
} from '@biddaloy/ui/i18n';
import { FullPageShell, useCloseFullPage } from '@biddaloy/ui/shells';
import { downloadCsv, formatDate, formatDateRange, formatNumber } from '@biddaloy/ui/utils';
import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { ChevronDown, Download, RotateCcw } from 'lucide-react';
import * as React from 'react';

import { loadRouteNamespaces } from '../../../../route-loaders';

const MAX_FILE_SIZE = 5 * 1024 * 1024; // mirrors the server's multer limit
const PREVIEW_ROW_LIMIT = 20;

/** The template's header row — verbatim from the server's parser
 * (`server/src/modules/homework/homework-bulk-upload.parser.ts`'s
 * `ALL_HEADERS`) — the template is client-generated, no server endpoint
 * exists for it. */
const TEMPLATE_HEADERS = [
  'class',
  'section',
  'subject',
  'assigned_date',
  'due_date',
  'description',
] as const;

type TemplateHeader = (typeof TEMPLATE_HEADERS)[number];

const REQUIRED_COLUMNS: ReadonlySet<TemplateHeader> = new Set([
  'class',
  'section',
  'subject',
  'assigned_date',
  'due_date',
]);

const TEMPLATE_EXAMPLE_ROW: Record<TemplateHeader, string> = {
  class: 'Class 5',
  section: 'A',
  subject: 'Mathematics',
  assigned_date: '2026-10-01',
  due_date: '2026-10-05',
  description: 'অনুশীলনী ৩.২',
};

function downloadTemplate(): void {
  downloadCsv('homework-import-template.csv', [
    TEMPLATE_HEADERS,
    TEMPLATE_HEADERS.map((header) => TEMPLATE_EXAMPLE_ROW[header]),
  ]);
}

/**
 * `/academics/homework/import` — [22.4.4]'s validate-then-confirm homework
 * import. Cloned from `/students/import`'s pattern; the guardian-invite
 * and whole-school-migration parts of that page are student-only and
 * dropped here.
 *
 * The permission check is a **UX** gate, not the security boundary —
 * `POST /homework/bulk/validate` and `/commit` enforce their own roles
 * server-side, same reasoning `/students/import` spells out.
 */
export const Route = createFileRoute('/_staff/academics/homework/import')({
  loader: () => loadRouteNamespaces('homework', 'bulkImport'),
  pendingComponent: ImportHomeworkPending,
  component: ImportHomeworkPage,
});

function ImportHomeworkPage() {
  const regionConfig = useTenantRegionConfig();

  return (
    <RegionConfigProvider value={regionConfig}>
      <ImportHomeworkContent />
    </RegionConfigProvider>
  );
}

function ImportHomeworkContent() {
  const { t } = useTranslation('homework');
  const validateMutation = useValidateHomeworkUpload();
  const commitMutation = useCommitHomeworkUpload();

  const { mutateAsync: validateAsync } = validateMutation;
  const { mutateAsync: commitAsync } = commitMutation;

  const validate = React.useCallback(
    (file: File, onProgress: (percent: number) => void) =>
      validateAsync({ file, onProgress }).catch((err: unknown) => {
        notifyOutcome({
          tenantId: captureNotificationTenant(),
          variant: 'error',
          message: t('import.notifications.failed'),
        });
        throw err;
      }),
    [validateAsync, t],
  );

  const commit = React.useCallback(
    (stagingId: string) =>
      commitAsync(stagingId).catch((err: unknown) => {
        notifyOutcome({
          tenantId: captureNotificationTenant(),
          variant: 'error',
          message: t('import.notifications.failed'),
        });
        throw err;
      }),
    [commitAsync, t],
  );

  const { t: tCommon } = useTranslation('common');
  const regionConfig = useRegionConfig();
  const navigate = useNavigate();
  const close = useCloseFullPage(() => void navigate({ to: '/academics/homework' }));
  const [controller, setController] = React.useState<
    BulkUploadPreviewController<HomeworkUploadSummary, HomeworkUploadResult> | undefined
  >(undefined);
  const [discardOpen, setDiscardOpen] = React.useState(false);

  const status = controller?.status ?? 'idle';
  const dirty = status === 'preview' || status === 'committing';
  const backToList = () => void navigate({ to: '/academics/homework' });

  const primary =
    status === 'done'
      ? { label: t('import.result.backToList'), onClick: backToList }
      : status === 'preview' || status === 'committing'
        ? {
            label: t('import.confirm', {
              count: controller?.result?.summary.rows_to_create ?? 0,
              n: formatNumber(controller?.result?.summary.rows_to_create ?? 0, regionConfig),
            }),
            onClick: () => controller?.confirm(),
            busy: status === 'committing',
            disabled: controller?.confirmDisabled ?? true,
          }
        : { label: t('import.confirmIdle'), onClick: () => undefined, disabled: true };

  return (
    <>
      <FullPageShell
        title={t('import.title')}
        size="wide"
        dirty={dirty}
        onClose={close}
        secondary={{
          label: status === 'done' ? tCommon('actions.close') : tCommon('actions.cancel'),
          // The footer's secondary bypasses the shell's dirty check.
          onClick: () => {
            if (status === 'committing') return;
            if (dirty) setDiscardOpen(true);
            else close();
          },
        }}
        primary={primary}
      >
        <div className="flex flex-col gap-6">
          <Card padded aria-labelledby="import-template-heading">
            <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between md:gap-6">
              <div>
                <h2 id="import-template-heading" className="text-h2">
                  {t('import.template.title')}
                </h2>
                <p className="mt-1 text-text-secondary">{t('import.template.explanation')}</p>
              </div>
              <Button
                type="button"
                variant="outline"
                className="w-full md:w-auto"
                onClick={downloadTemplate}
              >
                <Download aria-hidden="true" />
                {t('import.template.download')}
              </Button>
            </div>
            <details className="group mt-4 border-t border-border-subtle pt-2">
              <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-2 rounded-md font-medium md:min-h-8">
                {t('import.reference.caption')}
                <span className="flex items-center gap-2 text-text-secondary">
                  {t('import.reference.count', {
                    count: TEMPLATE_HEADERS.length,
                    n: formatNumber(TEMPLATE_HEADERS.length, regionConfig),
                  })}
                  <ChevronDown className="size-4 group-open:rotate-180" aria-hidden="true" />
                </span>
              </summary>
              <ul className="divide-y divide-border-subtle">
                {TEMPLATE_HEADERS.map((header) => (
                  <li
                    key={header}
                    className="flex flex-col gap-1 py-3 md:grid md:grid-cols-12 md:items-start md:gap-4"
                  >
                    <div className="flex items-center gap-2 md:col-span-4">
                      <span className="font-medium">{t(`import.reference.labels.${header}`)}</span>
                      {REQUIRED_COLUMNS.has(header) ? (
                        <StatusBadge tone="warning" label={t('import.reference.requiredYes')} />
                      ) : (
                        <StatusBadge tone="neutral" label={t('import.reference.requiredNo')} />
                      )}
                    </div>
                    <div className="flex flex-col gap-0.5 md:col-span-8">
                      <span>{t(`import.reference.columns.${header}`)}</span>
                      <span className="text-caption text-text-secondary">
                        {t('import.reference.headerName')}{' '}
                        <code className="rounded-sm bg-muted px-1 font-mono">{header}</code>
                      </span>
                    </div>
                  </li>
                ))}
              </ul>
            </details>
          </Card>

          <Card padded aria-labelledby="import-upload-heading">
            <h2 id="import-upload-heading" className="text-h2">
              {t('import.upload.title')}
            </h2>
            <p className="mt-1 mb-4 text-text-secondary">{t('import.upload.explanation')}</p>

            <BulkUploadPreview<HomeworkUploadSummary, HomeworkUploadResult>
              accept=".csv,.xlsx"
              maxFileSize={MAX_FILE_SIZE}
              validate={validate}
              commit={commit}
              hideConfirm
              onControllerChange={setController}
              renderSummary={() => null}
              renderDone={() => null}
            />
          </Card>

          {controller?.status === 'preview' || controller?.status === 'committing'
            ? controller.result && <ImportPreviewSummary result={controller.result} />
            : null}
          {controller?.status === 'done' && controller.commitResult && (
            <ImportDoneSummary
              result={controller.commitResult}
              onImportAnother={controller.reset}
            />
          )}
        </div>
      </FullPageShell>
      <ConfirmDialog
        open={discardOpen}
        onOpenChange={setDiscardOpen}
        title={tCommon('fullPage.discardTitle')}
        description={tCommon('fullPage.discardDescription')}
        confirmLabel={tCommon('fullPage.discardConfirm')}
        cancelLabel={tCommon('fullPage.keepEditing')}
        onConfirm={close}
      />
    </>
  );
}

function ImportPreviewSummary({ result }: { result: PreviewResult<HomeworkUploadSummary> }) {
  const { t } = useTranslation('homework');
  const regionConfig = useRegionConfig();
  const previewRows = result.summary.preview.slice(0, PREVIEW_ROW_LIMIT);
  const toCreate = result.summary.rows_to_create;
  return (
    <Card aria-labelledby="import-preview-heading" className="overflow-hidden">
      <div className="flex flex-col gap-2 px-4 pt-4 md:px-5">
        <h2 id="import-preview-heading" className="text-h2">
          {t('import.preview.title')}
        </h2>
        <p className="text-text-secondary">
          {t('import.preview.subtitle', {
            count: previewRows.length,
            n: formatNumber(previewRows.length, regionConfig),
          })}
        </p>
        <p className="flex flex-wrap items-center gap-2 font-medium">
          {result.hard_error_count === 0 && (
            <StatusBadge tone="success" label={t('import.preview.noProblems')} />
          )}
          {t('import.preview.willCreate', { count: toCreate })}
        </p>
      </div>
      {previewRows.length > 0 && (
        <div className="mt-3 w-full overflow-x-auto">
          <table className="w-full text-left">
            <thead>
              <tr className="border-y border-border-subtle text-text-secondary">
                <th scope="col" className="px-4 py-2 font-medium md:px-5">
                  {t('import.preview.columns.where')}
                </th>
                <th scope="col" className="hidden px-4 py-2 font-medium md:table-cell">
                  {t('import.preview.columns.assignedDate')}
                </th>
                <th scope="col" className="hidden px-4 py-2 font-medium md:table-cell">
                  {t('import.preview.columns.dueDate')}
                </th>
              </tr>
            </thead>
            <tbody>
              {previewRows.map((row) => (
                <tr key={row.row} className="border-b border-border-subtle">
                  <td className="px-4 py-2 md:px-5">
                    <span className="font-medium">
                      {row.class} · {row.section} · {row.subject}
                    </span>
                    <span className="block text-caption text-text-secondary md:hidden">
                      {formatDateRange(row.assigned_date, row.due_date, regionConfig)}
                    </span>
                  </td>
                  <td className="hidden px-4 py-2 md:table-cell">
                    {formatDate(row.assigned_date, regionConfig)}
                  </td>
                  <td className="hidden px-4 py-2 md:table-cell">
                    {formatDate(row.due_date, regionConfig)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="border-t border-border-subtle px-4 py-3 text-text-secondary md:px-5">
        {t('import.preview.shown', {
          shown: formatNumber(previewRows.length, regionConfig),
          total: formatNumber(toCreate, regionConfig),
        })}
      </p>
    </Card>
  );
}

function ImportDoneSummary({
  result,
  onImportAnother,
}: {
  result: HomeworkUploadResult;
  onImportAnother: () => void;
}) {
  const { t } = useTranslation('homework');

  React.useEffect(() => {
    const notifyTenantId = captureNotificationTenant();
    notifyOutcome({
      tenantId: notifyTenantId,
      variant: result.error_count > 0 ? 'info' : 'success',
      message:
        result.error_count > 0
          ? t('import.notifications.partial', {
              success: result.success_count,
              total: result.total_rows,
              errors: result.error_count,
            })
          : t('import.notifications.imported', {
              success: result.success_count,
              total: result.total_rows,
            }),
    });
    // Intentionally runs once per mount (a fresh commit result), not on
    // every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <Card padded aria-labelledby="import-result-heading" className="flex flex-col gap-3">
      <h2 id="import-result-heading" className="text-h2">
        {t('import.result.title')}
      </h2>
      <p className="flex flex-wrap items-center gap-2">
        <StatusBadge
          tone={result.error_count > 0 ? 'warning' : 'success'}
          label={t(
            result.error_count > 0 ? 'import.result.badgePartial' : 'import.result.badgeDone',
          )}
        />
        {result.error_count === 0
          ? t('import.result.created', { count: result.success_count })
          : t('import.result.partialSummary', {
              success: result.success_count,
              total: result.total_rows,
              errors: result.error_count,
            })}
      </p>
      <div>
        <Button type="button" variant="ghost" onClick={onImportAnother}>
          <RotateCcw aria-hidden="true" />
          {t('import.result.importAnother')}
        </Button>
      </div>
    </Card>
  );
}

function ImportHomeworkPending() {
  const { t } = useTranslation('nav');
  return <RoutePending variant="form" label={t('routePending.label', { ns: 'nav' })} />;
}

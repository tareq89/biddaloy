import { captureNotificationTenant, notifyOutcome } from '@biddaloy/ui/api';
import { Button, BulkUploadPreview, RoutePending } from '@biddaloy/ui/components';
import {
  useCommitHomeworkUpload,
  useValidateHomeworkUpload,
  type HomeworkUploadResult,
  type HomeworkUploadSummary,
} from '@biddaloy/ui/hooks';
import type { PreviewResult } from '@biddaloy/ui/hooks';
import { RegionConfigProvider, useTenantRegionConfig, useTranslation } from '@biddaloy/ui/i18n';
import { downloadCsv } from '@biddaloy/ui/utils';
import { createFileRoute, Link } from '@tanstack/react-router';
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

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-6">
      <h1 className="text-lg font-semibold">{t('import.title')}</h1>

      <section aria-labelledby="import-template-heading" className="flex flex-col gap-2">
        <h2 id="import-template-heading" className="text-base font-semibold">
          {t('import.template.title')}
        </h2>
        <p className="text-sm text-muted-foreground">{t('import.template.explanation')}</p>
        <div>
          <Button type="button" variant="outline" onClick={downloadTemplate}>
            {t('import.template.download')}
          </Button>
        </div>
        <div className="mt-2 w-full overflow-x-auto">
          <table className="w-full text-left text-sm">
            <caption className="mb-1 text-left text-sm font-medium">
              {t('import.reference.caption')}
            </caption>
            <thead>
              <tr className="border-b border-border-subtle">
                <th scope="col" className="py-1 pr-4 font-medium">
                  {t('import.reference.column')}
                </th>
                <th scope="col" className="py-1 pr-4 font-medium">
                  {t('import.reference.required')}
                </th>
                <th scope="col" className="py-1 font-medium">
                  {t('import.reference.format')}
                </th>
              </tr>
            </thead>
            <tbody>
              {TEMPLATE_HEADERS.map((header) => (
                <tr key={header} className="border-b border-border-subtle">
                  <td className="py-1 pr-4 font-mono text-xs break-all">{header}</td>
                  <td className="py-1 pr-4">
                    {REQUIRED_COLUMNS.has(header)
                      ? t('import.reference.requiredYes')
                      : t('import.reference.requiredNo')}
                  </td>
                  <td className="py-1">{t(`import.reference.columns.${header}`)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section aria-labelledby="import-upload-heading" className="flex flex-col gap-2">
        <h2 id="import-upload-heading" className="text-base font-semibold">
          {t('import.upload.title')}
        </h2>
        <p className="text-sm text-muted-foreground">{t('import.upload.explanation')}</p>

        <BulkUploadPreview<HomeworkUploadSummary, HomeworkUploadResult>
          accept=".csv,.xlsx"
          maxFileSize={MAX_FILE_SIZE}
          validate={validate}
          commit={commit}
          renderSummary={(result) => <ImportPreviewSummary result={result} />}
          renderDone={(result, reset) => (
            <ImportDoneSummary result={result} onImportAnother={reset} />
          )}
        />
      </section>
    </div>
  );
}

function ImportPreviewSummary({ result }: { result: PreviewResult<HomeworkUploadSummary> }) {
  const { t } = useTranslation('homework');
  const previewRows = result.summary.preview.slice(0, PREVIEW_ROW_LIMIT);
  return (
    <div className="flex flex-col gap-2">
      <p className="text-sm font-medium">
        {t('import.preview.willCreate', { count: result.summary.rows_to_create })}
      </p>
      {previewRows.length > 0 && (
        <div className="w-full overflow-x-auto">
          <table className="w-full text-left text-sm">
            <caption className="mb-1 text-left text-sm font-medium">
              {t('import.preview.previewCaption', { count: previewRows.length })}
            </caption>
            <thead>
              <tr className="border-b border-border-subtle">
                <th scope="col" className="py-1 pr-4 font-medium">
                  {t('import.preview.columns.class')}
                </th>
                <th scope="col" className="py-1 pr-4 font-medium">
                  {t('import.preview.columns.section')}
                </th>
                <th scope="col" className="py-1 pr-4 font-medium">
                  {t('import.preview.columns.subject')}
                </th>
                <th scope="col" className="py-1 pr-4 font-medium">
                  {t('import.preview.columns.assignedDate')}
                </th>
                <th scope="col" className="py-1 font-medium">
                  {t('import.preview.columns.dueDate')}
                </th>
              </tr>
            </thead>
            <tbody>
              {previewRows.map((row) => (
                <tr key={row.row} className="border-b border-border-subtle">
                  <td className="py-1 pr-4">{row.class}</td>
                  <td className="py-1 pr-4">{row.section}</td>
                  <td className="py-1 pr-4">{row.subject}</td>
                  <td className="py-1 pr-4">{row.assigned_date}</td>
                  <td className="py-1">{row.due_date}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
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
    <section aria-labelledby="import-result-heading" className="flex flex-col gap-3">
      <h2 id="import-result-heading" className="text-base font-semibold">
        {t('import.result.title')}
      </h2>
      {result.error_count === 0 ? (
        <p className="rounded-md border border-border-subtle bg-muted p-3 text-sm">
          {t('import.result.created', { count: result.success_count })}
        </p>
      ) : (
        <p className="rounded-md border border-border-subtle bg-muted p-3 text-sm">
          {t('import.result.partialSummary', {
            success: result.success_count,
            total: result.total_rows,
            errors: result.error_count,
          })}
        </p>
      )}
      <div className="flex items-center gap-2">
        <Button type="button" variant="outline" onClick={onImportAnother}>
          {t('import.result.importAnother')}
        </Button>
        <Link to="/academics/homework" className="text-sm text-primary underline">
          {t('import.result.backToList')}
        </Link>
      </div>
    </section>
  );
}

function ImportHomeworkPending() {
  const { t } = useTranslation('nav');
  return <RoutePending variant="form" label={t('routePending.label', { ns: 'nav' })} />;
}

import { captureNotificationTenant, notifyOutcome } from '@biddaloy/ui/api';
import { Button, ErrorState, FileUpload, RoutePending } from '@biddaloy/ui/components';
import { useBulkUploadStudents, type BulkUploadResult } from '@biddaloy/ui/hooks';
import { RegionConfigProvider, useTenantRegionConfig, useTranslation } from '@biddaloy/ui/i18n';
import { createFileRoute } from '@tanstack/react-router';
import * as React from 'react';

import { loadRouteNamespaces } from '../../../route-loaders';

import { ImportErrorTable } from './-import/error-table';
import { downloadTemplate, TEMPLATE_HEADERS, type TemplateHeader } from './-import/template';

const MAX_FILE_SIZE = 5 * 1024 * 1024; // mirrors the server's multer limit
const ACCEPTED_EXTENSIONS = ['.csv', '.xlsx'];

/**
 * `/students/import` — [8.11.7]'s bulk student import. Template download
 * and column reference before upload, client-side type/size checks, an
 * `aria-live` progress announcement, and an unambiguous partial-success
 * report ("X of Y imported, Z rows had problems" — neither a green tick
 * nor a red failure) with a per-row, CSV-exportable error table.
 *
 * The permission check is a **UX** gate, not the security boundary —
 * `POST /students/bulk-upload` enforces its own roles server-side, same
 * reasoning `fees/generate.tsx` spells out.
 */
export const Route = createFileRoute('/_staff/students/import')({
  loader: () => loadRouteNamespaces('studentImport'),
  pendingComponent: ImportStudentsPending,
  component: ImportStudentsPage,
});

/** Which columns the server requires per row, mirrored from
 * `BulkUploadRowDto` for the on-page column reference. */
const REQUIRED_COLUMNS: ReadonlySet<TemplateHeader> = new Set([
  'student_name',
  'class',
  'section',
  'guardian1_name',
  'guardian1_phone',
]);

function hasAcceptedExtension(name: string): boolean {
  const lower = name.toLowerCase();
  return ACCEPTED_EXTENSIONS.some((ext) => lower.endsWith(ext));
}

// [8.14.17]: the permission check that used to live at the top of
// `ImportStudentsPage` (an `EmptyState` shown when the viewer lacked
// `STUDENT_BULK_UPLOAD`) is gone — `_staff.tsx`'s `RequirePermission`
// now refuses the whole route in place, keyed off the same permission
// (`route-permissions.ts`), before this component ever mounts.
function ImportStudentsPage() {
  const regionConfig = useTenantRegionConfig();

  return (
    <RegionConfigProvider value={regionConfig}>
      <ImportStudentsContent />
    </RegionConfigProvider>
  );
}

function ImportStudentsContent() {
  const { t } = useTranslation('studentImport');
  const mutation = useBulkUploadStudents();

  const [selectedFile, setSelectedFile] = React.useState<File | null>(null);
  const [fileError, setFileError] = React.useState<string | null>(null);
  const [progress, setProgress] = React.useState<number | undefined>(undefined);
  const [result, setResult] = React.useState<BulkUploadResult | null>(null);

  function handleFilesSelected(files: File[]) {
    const file = files[0];
    if (!file) return;
    // `mutation.reset()` clears state but cannot cancel a request already on
    // the wire, so a second pick mid-flight would import the same students
    // twice. FileUpload is disabled while pending; this is the guard behind it.
    if (mutation.isPending) return;
    setResult(null);
    mutation.reset();
    setProgress(undefined);
    // Client-side gate mirrors the server's own extension/size checks
    // (trust boundary stays server-side; this just fails fast, before a
    // 5 MB upload burns one of the endpoint's 5/min throttle slots).
    if (!hasAcceptedExtension(file.name)) {
      setSelectedFile(file);
      setFileError(t('upload.errorType'));
      return;
    }
    if (file.size > MAX_FILE_SIZE) {
      setSelectedFile(file);
      setFileError(t('upload.errorSize'));
      return;
    }
    setFileError(null);
    setSelectedFile(file);
    const notifyTenantId = captureNotificationTenant();
    mutation.mutate(
      { file, onProgress: setProgress },
      {
        onSuccess: (uploadResult) => {
          setProgress(100);
          setResult(uploadResult);
          notifyOutcome({
            tenantId: notifyTenantId,
            variant: uploadResult.error_count > 0 ? 'info' : 'success',
            message:
              uploadResult.error_count > 0
                ? t('notifications.partial', {
                    success: uploadResult.success_count,
                    total: uploadResult.total_rows,
                    errors: uploadResult.error_count,
                  })
                : t('notifications.imported', {
                    success: uploadResult.success_count,
                    total: uploadResult.total_rows,
                  }),
          });
        },
        // Without this the item keeps its 100% "Done" label directly above
        // an error state saying nothing was imported.
        onError: () => {
          setProgress(undefined);
          notifyOutcome({
            tenantId: notifyTenantId,
            variant: 'error',
            message: t('notifications.failed'),
          });
        },
      },
    );
  }

  function resetForAnotherFile() {
    if (mutation.isPending) return;
    setSelectedFile(null);
    setFileError(null);
    setProgress(undefined);
    setResult(null);
    mutation.reset();
  }

  const requestError = mutation.error?.message;

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-6">
      <h1 className="text-lg font-semibold">{t('title')}</h1>

      <section aria-labelledby="import-template-heading" className="flex flex-col gap-2">
        <h2 id="import-template-heading" className="text-base font-semibold">
          {t('template.title')}
        </h2>
        <p className="text-sm text-muted-foreground">{t('template.explanation')}</p>
        <div>
          <Button type="button" variant="outline" onClick={downloadTemplate}>
            {t('template.download')}
          </Button>
        </div>
        {/* [8.14.7]: `break-all` on the header-name cells (below) keeps this
            table's min-content width under 320px on its own — the longest
            identifier, `preferred_communication`, was the one unbreakable
            token wide enough to force this box into scroll. `overflow-x-
            auto` stays as a defensive fallback, not the fix: no element
            should need its own inner scroll region per the reflow contract
            DataTable's card mode established. */}
        <div className="mt-2 w-full overflow-x-auto">
          <table className="w-full text-left text-sm">
            <caption className="mb-1 text-left text-sm font-medium">
              {t('reference.caption')}
            </caption>
            <thead>
              <tr className="border-b border-border-subtle">
                <th scope="col" className="py-1 pr-4 font-medium">
                  {t('reference.column')}
                </th>
                <th scope="col" className="py-1 pr-4 font-medium">
                  {t('reference.required')}
                </th>
                <th scope="col" className="py-1 font-medium">
                  {t('reference.format')}
                </th>
              </tr>
            </thead>
            <tbody>
              {TEMPLATE_HEADERS.map((header) => (
                <tr key={header} className="border-b border-border-subtle">
                  <td className="py-1 pr-4 font-mono text-xs break-all">{header}</td>
                  <td className="py-1 pr-4">
                    {REQUIRED_COLUMNS.has(header)
                      ? t('reference.requiredYes')
                      : t('reference.requiredNo')}
                  </td>
                  <td className="py-1">{t(`reference.columns.${header}`)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section aria-labelledby="import-upload-heading" className="flex flex-col gap-2">
        <h2 id="import-upload-heading" className="text-base font-semibold">
          {t('upload.title')}
        </h2>
        <p className="text-sm text-muted-foreground">{t('upload.explanation')}</p>
        <FileUpload
          items={
            selectedFile
              ? [
                  {
                    id: 'import-file',
                    file: selectedFile,
                    ...(progress !== undefined ? { progress } : {}),
                    ...(fileError ? { error: fileError } : {}),
                  },
                ]
              : []
          }
          onFilesSelected={handleFilesSelected}
          onRemove={resetForAnotherFile}
          disabled={mutation.isPending}
          accept=".csv,.xlsx"
          multiple={false}
          aria-label={t('upload.inputLabel')}
          chooseLabel={t('upload.chooseFile')}
        />
        <div aria-live="polite" className="text-sm text-muted-foreground">
          {/* onUploadProgress reaches 100% once the request body is flushed,
              but the server then imports rows synchronously — for a large
              file that is minutes more work. Announce that separately rather
              than freezing on "Uploading… 100%". */}
          {mutation.isPending && progress !== undefined
            ? progress < 100
              ? t('upload.progress', { percent: progress })
              : t('upload.processing')
            : null}
        </div>
      </section>

      {mutation.isError && (
        <ErrorState
          message={t('result.requestFailed', { message: requestError })}
          onRetry={resetForAnotherFile}
          retryLabel={t('result.tryAnotherFile')}
        />
      )}

      {result && (
        <section aria-labelledby="import-result-heading" className="flex flex-col gap-3">
          <h2 id="import-result-heading" className="text-base font-semibold">
            {t('result.title')}
          </h2>
          {result.error_count === 0 ? (
            <p className="rounded-md border border-border-subtle bg-muted p-3 text-sm">
              {t('result.allImported', { count: result.success_count })}
            </p>
          ) : (
            // Deliberately neutral styling: partial success is the normal
            // case — neither a green tick nor a red failure.
            <p className="rounded-md border border-border-subtle bg-muted p-3 text-sm">
              {t('result.partialSummary', {
                success: result.success_count,
                total: result.total_rows,
                errors: result.error_count,
              })}
            </p>
          )}
          {result.error_count > 0 && <ImportErrorTable errors={result.errors} />}
          <div>
            <Button type="button" variant="outline" onClick={resetForAnotherFile}>
              {t('result.importAnother')}
            </Button>
          </div>
        </section>
      )}
    </div>
  );
}

function ImportStudentsPending() {
  const { t } = useTranslation('nav');
  return <RoutePending variant="form" label={t('routePending.label', { ns: 'nav' })} />;
}

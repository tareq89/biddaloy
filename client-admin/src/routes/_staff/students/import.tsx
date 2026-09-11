import { captureNotificationTenant, notifyOutcome } from '@biddaloy/ui/api';
import { Button, Checkbox, BulkUploadPreview, RoutePending } from '@biddaloy/ui/components';
import {
  useValidateStudentUpload,
  useCommitStudentUpload,
  type BulkUploadResult,
  type StudentUploadSummary,
} from '@biddaloy/ui/hooks';
import type { PreviewResult } from '@biddaloy/ui/hooks';
import { RegionConfigProvider, useTenantRegionConfig, useTranslation } from '@biddaloy/ui/i18n';
import { createFileRoute } from '@tanstack/react-router';
import * as React from 'react';

import { loadRouteNamespaces } from '../../../route-loaders';
import { InviteGuardiansDialog } from '../guardians/-invite-guardians-dialog';

import { downloadTemplate, TEMPLATE_HEADERS, type TemplateHeader } from './-import/template';

const MAX_FILE_SIZE = 5 * 1024 * 1024; // mirrors the server's multer limit
const PREVIEW_ROW_LIMIT = 20;

/**
 * `/students/import` — [14.9.2]'s validate-then-confirm student import.
 *
 * Everything upload/preview/confirm/commit is `BulkUploadPreview` (#587);
 * this page only supplies the two network calls and the student-specific
 * `renderSummary`/`renderDone` slots — the template download and column
 * reference above it are unchanged from [8.11.7].
 *
 * The permission check is a **UX** gate, not the security boundary —
 * `POST /students/bulk-upload/validate` and `/commit` enforce their own
 * roles server-side, same reasoning `fees/generate.tsx` spells out.
 */
export const Route = createFileRoute('/_staff/students/import')({
  loader: () => loadRouteNamespaces('studentImport', 'guardians', 'bulkImport'),
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
  const validateMutation = useValidateStudentUpload();
  const commitMutation = useCommitStudentUpload();

  // Depend on `mutateAsync`, not the mutation object: react-query returns a
  // fresh object every render, so keying on it changed these callbacks (and
  // with them `useBulkUploadPreview`'s `selectFile`/`confirm`) every render,
  // making the memoisation a no-op. `mutateAsync` is stable.
  const { mutateAsync: validateAsync } = validateMutation;
  const { mutateAsync: commitAsync } = commitMutation;

  const validate = React.useCallback(
    (file: File, onProgress: (percent: number) => void) =>
      validateAsync({ file, onProgress }).catch((err: unknown) => {
        // The inline failure Card is the primary signal, but a user who
        // navigated away mid-validate would otherwise get none at all.
        notifyOutcome({
          tenantId: captureNotificationTenant(),
          variant: 'error',
          message: t('notifications.failed'),
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
          message: t('notifications.failed'),
        });
        throw err;
      }),
    [commitAsync, t],
  );

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

        <BulkUploadPreview<StudentUploadSummary, BulkUploadResult>
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

/**
 * `renderSummary` slot content — "N students will be created" plus the
 * first `PREVIEW_ROW_LIMIT` accepted rows. Extracted to its own named
 * component (rather than an inline closure) so it has a Storybook story
 * covering the ticket's required "preview-with-errors" state — the error
 * table itself is `BulkUploadPreview`'s own concern, rendered alongside
 * this, not inside it.
 */
export function ImportPreviewSummary({ result }: { result: PreviewResult<StudentUploadSummary> }) {
  const { t } = useTranslation('studentImport');
  const previewRows = result.summary.preview.slice(0, PREVIEW_ROW_LIMIT);
  return (
    <div className="flex flex-col gap-2">
      <p className="text-sm font-medium">
        {t('preview.willCreate', { count: result.summary.rows_to_create })}
      </p>
      {previewRows.length > 0 && (
        <div className="w-full overflow-x-auto">
          <table className="w-full text-left text-sm">
            <caption className="mb-1 text-left text-sm font-medium">
              {t('preview.previewCaption', { count: previewRows.length })}
            </caption>
            <thead>
              <tr className="border-b border-border-subtle">
                <th scope="col" className="py-1 pr-4 font-medium">
                  {t('preview.columns.name')}
                </th>
                <th scope="col" className="py-1 pr-4 font-medium">
                  {t('preview.columns.class')}
                </th>
                <th scope="col" className="py-1 pr-4 font-medium">
                  {t('preview.columns.section')}
                </th>
                <th scope="col" className="py-1 font-medium">
                  {t('preview.columns.guardianPhone')}
                </th>
              </tr>
            </thead>
            <tbody>
              {previewRows.map((row) => (
                <tr key={row.row} className="border-b border-border-subtle">
                  <td className="py-1 pr-4">{row.student_name}</td>
                  <td className="py-1 pr-4">{row.class}</td>
                  <td className="py-1 pr-4">{row.section}</td>
                  <td className="py-1">{row.guardian1_phone}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

export function ImportDoneSummary({
  result,
  onImportAnother,
}: {
  result: BulkUploadResult;
  onImportAnother: () => void;
}) {
  const { t } = useTranslation('studentImport');
  const [inviteGuardians, setInviteGuardians] = React.useState(false);
  const [inviteDialogOpen, setInviteDialogOpen] = React.useState(false);

  // Fired once, when this "done" view first mounts for a given result — a
  // notification about the commit that just happened, same convention the
  // old single-request page used.
  React.useEffect(() => {
    const notifyTenantId = captureNotificationTenant();
    notifyOutcome({
      tenantId: notifyTenantId,
      variant: result.error_count > 0 ? 'info' : 'success',
      message:
        result.error_count > 0
          ? t('notifications.partial', {
              success: result.success_count,
              total: result.total_rows,
              errors: result.error_count,
            })
          : t('notifications.imported', {
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
        {t('result.title')}
      </h2>
      {result.error_count === 0 ? (
        <p className="rounded-md border border-border-subtle bg-muted p-3 text-sm">
          {t('result.allImported', { count: result.success_count })}
        </p>
      ) : (
        // Deliberately neutral styling: partial success is the normal
        // case — neither a green tick nor a red failure. In practice the
        // all-or-nothing commit rule (#605) means this branch should never
        // be reached from this page, but the DTO still carries the field.
        <p className="rounded-md border border-border-subtle bg-muted p-3 text-sm">
          {t('result.partialSummary', {
            success: result.success_count,
            total: result.total_rows,
            errors: result.error_count,
          })}
        </p>
      )}
      {result.created_student_ids.length > 0 && (
        <span className="flex items-center gap-2 text-sm">
          <Checkbox
            id="invite-imported-guardians"
            checked={inviteGuardians}
            onCheckedChange={(checked) => {
              const next = checked === true;
              setInviteGuardians(next);
              if (next) setInviteDialogOpen(true);
            }}
          />
          <label htmlFor="invite-imported-guardians">{t('inviteGuardians.checkboxLabel')}</label>
        </span>
      )}
      <div>
        <Button type="button" variant="outline" onClick={onImportAnother}>
          {t('result.importAnother')}
        </Button>
      </div>

      {result.created_student_ids.length > 0 && (
        <InviteGuardiansDialog
          open={inviteDialogOpen}
          onOpenChange={setInviteDialogOpen}
          studentIds={result.created_student_ids}
        />
      )}
    </section>
  );
}

function ImportStudentsPending() {
  const { t } = useTranslation('nav');
  return <RoutePending variant="form" label={t('routePending.label', { ns: 'nav' })} />;
}

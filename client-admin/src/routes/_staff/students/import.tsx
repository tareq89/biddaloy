import { Permission } from '@biddaloy/shared';
import { captureNotificationTenant, notifyOutcome } from '@biddaloy/ui/api';
import {
  BulkUploadPreview,
  Button,
  Card,
  Checkbox,
  RoutePending,
  StatusBadge,
  type BulkUploadPreviewController,
} from '@biddaloy/ui/components';
import {
  useHasPermission,
  useValidateStudentUpload,
  useCommitStudentUpload,
  type BulkUploadResult,
  type StudentUploadSummary,
} from '@biddaloy/ui/hooks';
import type { PreviewResult } from '@biddaloy/ui/hooks';
import {
  RegionConfigProvider,
  useRegionConfig,
  useTenantRegionConfig,
  useTranslation,
} from '@biddaloy/ui/i18n';
import { FullPageShell } from '@biddaloy/ui/shells';
import { formatPhone } from '@biddaloy/ui/utils';
import { createFileRoute, Link, useNavigate, useSearch } from '@tanstack/react-router';
import { ChevronDownIcon, DownloadIcon } from 'lucide-react';
import * as React from 'react';

import { loadRouteNamespaces } from '../../../route-loaders';
import { InviteGuardiansDialog } from '../guardians/-invite-guardians-dialog';

import { downloadTemplate, REQUIRED_COLUMNS, TEMPLATE_HEADERS } from './-import/template';

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
  staticData: { chromeless: true },
  loader: () => loadRouteNamespaces('studentImport', 'guardians', 'bulkImport', 'backup', 'trial'),
  pendingComponent: ImportStudentsPending,
  component: ImportStudentsPage,
});

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
  const { t: tBackup } = useTranslation('backup');
  const canManageBackup = useHasPermission(Permission.BACKUP_MANAGE);
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

  const navigate = useNavigate();
  const { t: tTrial } = useTranslation('trial');
  const fromWelcome = useSearch({ strict: false }).from === 'welcome';
  const [upload, setUpload] = React.useState<
    BulkUploadPreviewController<StudentUploadSummary, BulkUploadResult> | undefined
  >(undefined);
  const close = () => void navigate({ to: '/students' });
  const status = upload?.status;

  // The footer follows the upload's state; the confirm button lives here, not
  // inside the upload card, so the view keeps exactly one primary button.
  const primary =
    status === 'done'
      ? { label: t('result.goToList'), onClick: close }
      : (status === 'preview' || status === 'committing') && upload?.result
        ? {
            label: t('confirmAction', { count: upload.result.summary.rows_to_create }),
            onClick: upload.confirm,
            disabled: upload.confirmDisabled,
            busy: status === 'committing',
          }
        : { label: t('confirmActionIdle'), onClick: () => {}, disabled: true };
  const secondary =
    status === 'done'
      ? { label: t('actions.close', { ns: 'common' }), onClick: close }
      : { label: t('cancelAction'), onClick: close };

  return (
    <FullPageShell
      title={t('title')}
      size="wide"
      onClose={close}
      primary={primary}
      secondary={secondary}
    >
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-4 p-4 md:p-6">
        {/* [13.5.1]: the welcome wizard's people step links here with `?from=welcome`. */}
        {fromWelcome && (
          <Link
            to="/welcome"
            search={{ step: 'people' }}
            className="inline-flex min-h-11 items-center text-primary underline underline-offset-2 md:min-h-8"
          >
            {tTrial('import.backToSetup')}
          </Link>
        )}
        <Card padded asChild>
          <section aria-labelledby="import-template-heading">
            <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between md:gap-6">
              <div>
                <h2 id="import-template-heading" className="text-h3">
                  {t('template.title')}
                </h2>
                <p className="mt-1 text-text-secondary">{t('template.explanation')}</p>
              </div>
              <Button
                type="button"
                variant="outline"
                className="w-full md:w-auto"
                onClick={downloadTemplate}
              >
                <DownloadIcon className="size-4" aria-hidden />
                {t('template.download')}
              </Button>
            </div>
            <details className="group mt-4 border-t border-border-subtle pt-2">
              <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-2 rounded-md font-medium md:min-h-8">
                <span>{t('reference.toggle')}</span>
                <span className="flex items-center gap-2 text-text-secondary">
                  {t('reference.count', { count: TEMPLATE_HEADERS.length })}
                  <ChevronDownIcon
                    className="size-4 transition-transform group-open:rotate-180"
                    aria-hidden
                  />
                </span>
              </summary>
              <ul className="divide-y divide-border-subtle">
                {TEMPLATE_HEADERS.map((header) => (
                  <li
                    key={header}
                    className="flex flex-col gap-1 py-3 md:grid md:grid-cols-12 md:gap-4"
                  >
                    <span className="flex items-center gap-2 font-medium md:col-span-4">
                      {t(`reference.labels.${header}`)}
                      {REQUIRED_COLUMNS.has(header) ? (
                        <StatusBadge tone="warning" label={t('reference.requiredYes')} />
                      ) : (
                        <StatusBadge tone="neutral" label={t('reference.requiredNo')} />
                      )}
                    </span>
                    <span className="md:col-span-8">
                      {t(`reference.columns.${header}`)}
                      <span className="block text-caption text-text-secondary">
                        {t('reference.headerName')}{' '}
                        <code className="rounded-sm bg-muted px-1 font-mono">{header}</code>
                      </span>
                    </span>
                  </li>
                ))}
              </ul>
            </details>
            {/* [14.13.2]: entry point toward the whole-school migration flow —
                only rendered for a viewer who could actually act on it
                (`BACKUP_MANAGE` gates `/settings`'s restore wizard server-side
                too, so this is UX-only). */}
            {canManageBackup && (
              <p className="mt-2 text-text-secondary">
                {tBackup('migrateWholeSchool')}{' '}
                <Link
                  to="/settings"
                  className="font-medium text-primary underline underline-offset-2"
                >
                  {tBackup('migrateWholeSchoolLink')}
                </Link>
              </p>
            )}
          </section>
        </Card>

        <Card padded asChild>
          <section aria-labelledby="import-upload-heading" className="flex flex-col gap-3">
            <div>
              <h2 id="import-upload-heading" className="text-h3">
                {t('upload.title')}
              </h2>
              <p className="mt-1 text-text-secondary">{t('upload.explanation')}</p>
            </div>

            <BulkUploadPreview<StudentUploadSummary, BulkUploadResult>
              hideConfirm
              onControllerChange={setUpload}
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
        </Card>

        {(status === 'preview' || status === 'committing') && upload?.result && (
          <ImportPreviewCard result={upload.result} />
        )}
      </div>
    </FullPageShell>
  );
}

/**
 * `renderSummary` slot content: the "N students will be created" line. The
 * preview table is its own card, `ImportPreviewCard`, rendered by the page
 * next to the upload card (no nested cards).
 */
export function ImportPreviewSummary({ result }: { result: PreviewResult<StudentUploadSummary> }) {
  const { t } = useTranslation('studentImport');
  const { t: tTrial } = useTranslation('trial');
  const seats = result.summary.seats;
  const clean = result.hard_error_count === 0 && result.errors.length === 0;
  return (
    <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
      <div className="flex flex-wrap items-center gap-2">
        {clean && <StatusBadge tone="success" label={t('preview.noProblems')} />}
        <span className="font-medium">
          {t('preview.willCreate', { count: result.summary.rows_to_create })}
        </span>
      </div>
      {seats && seats.limit !== null && (
        <span className="text-text-secondary">{tTrial('import.seats', seats)}</span>
      )}
    </div>
  );
}

/** The first `PREVIEW_ROW_LIMIT` accepted rows. Below `md` each row is two
 * lines (name, then class · section · phone) instead of a four-column table. */
export function ImportPreviewCard({ result }: { result: PreviewResult<StudentUploadSummary> }) {
  const { t } = useTranslation('studentImport');
  const config = useRegionConfig();
  const previewRows = result.summary.preview.slice(0, PREVIEW_ROW_LIMIT);
  if (previewRows.length === 0) return null;
  // Falls back to the typed text when it is not a phone number formatPhone knows.
  const phoneOf = (raw: string | undefined) => (raw ? formatPhone(raw, config) || raw : '');
  return (
    <Card padded asChild>
      <section aria-labelledby="import-preview-heading" className="flex flex-col gap-3">
        <div>
          <h2 id="import-preview-heading" className="text-h3">
            {t('preview.title')}
          </h2>
          <p className="mt-1 text-text-secondary">
            {t('preview.subtitle', { count: previewRows.length })}
          </p>
        </div>
        <table className="w-full text-start">
          <caption className="sr-only">
            {t('preview.previewCaption', { count: previewRows.length })}
          </caption>
          <thead className="max-md:sr-only">
            <tr className="border-b border-border-subtle">
              <th scope="col" className="py-1 pe-4 font-medium">
                {t('preview.columns.name')}
              </th>
              <th scope="col" className="py-1 pe-4 font-medium">
                {t('preview.columns.class')}
              </th>
              <th scope="col" className="py-1 pe-4 font-medium">
                {t('preview.columns.section')}
              </th>
              <th scope="col" className="py-1 font-medium">
                {t('preview.columns.guardianPhone')}
              </th>
            </tr>
          </thead>
          <tbody>
            {previewRows.map((row) => (
              <tr
                key={row.row}
                className="border-b border-border-subtle max-md:flex max-md:flex-col max-md:py-2"
              >
                <td className="py-1 pe-4 font-medium md:font-normal">{row.student_name}</td>
                <td className="py-1 pe-4 max-md:hidden">{row.class}</td>
                <td className="py-1 pe-4 max-md:hidden">{row.section}</td>
                <td className="py-1 max-md:hidden">{phoneOf(row.guardian1_phone)}</td>
                <td className="text-caption text-text-secondary md:hidden">
                  {[row.class, row.section, phoneOf(row.guardian1_phone)]
                    .filter(Boolean)
                    .join(' · ')}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="text-text-secondary">
          {t('preview.shownOf', {
            shown: previewRows.length,
            total: result.summary.rows_to_create,
          })}
        </p>
      </section>
    </Card>
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
      <h2 id="import-result-heading" className="text-h3">
        {t('result.title')}
      </h2>
      <div className="flex flex-wrap items-center gap-2">
        {result.error_count === 0 && <StatusBadge tone="success" label={t('preview.noProblems')} />}
        <p>
          {result.error_count === 0
            ? t('result.allImported', { count: result.success_count })
            : t('result.partialSummary', {
                success: result.success_count,
                total: result.total_rows,
                errors: result.error_count,
              })}
        </p>
      </div>
      {result.created_student_ids.length > 0 && (
        <label
          htmlFor="invite-imported-guardians"
          className="flex min-h-11 items-center gap-3 md:min-h-8"
        >
          <Checkbox
            id="invite-imported-guardians"
            checked={inviteGuardians}
            onCheckedChange={(checked) => {
              const next = checked === true;
              setInviteGuardians(next);
              if (next) setInviteDialogOpen(true);
            }}
          />
          {t('inviteGuardians.checkboxLabel')}
        </label>
      )}
      <div>
        <Button type="button" variant="ghost" onClick={onImportAnother}>
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

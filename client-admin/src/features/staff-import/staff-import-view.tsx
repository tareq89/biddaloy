import { BulkUploadPreview, Button, Card, Checkbox, StatusBadge } from '@biddaloy/ui/components';
import {
  useCommitStaffUpload,
  useValidateStaffUpload,
  type PreviewResult,
  type StaffImportResult,
  type StaffUploadSummary,
} from '@biddaloy/ui/hooks';
import { useTranslation } from '@biddaloy/ui/i18n';
import { PageContainer, PageHeader } from '@biddaloy/ui/shells';
import { Link, useSearch } from '@tanstack/react-router';
import { DownloadIcon } from 'lucide-react';
import * as React from 'react';

import { downloadStaffTemplate, IMPORTABLE_ROLES, STAFF_COLUMNS } from './template';

const MAX_FILE_SIZE = 5 * 1024 * 1024; // mirrors the server's multer limit
const PREVIEW_ROW_LIMIT = 20;

type Result = PreviewResult<StaffUploadSummary>;

/**
 * Maps the server's English row problems to `staffImport:rowErrors.*`. The
 * server sends text only (no codes), so this matches on the message start;
 * anything unrecognised falls back to a per-column message and never leaks
 * English. Exported for the test.
 */
export function rowErrorKey(error: { column: string | null; message: string }): string {
  const m = error.message;
  if (m.startsWith('Unknown role')) return 'unknownRole';
  if (m.startsWith('Name is required')) return 'nameRequired';
  if (m.startsWith('Give a mobile')) return 'missingContact';
  if (m.startsWith('Mobile was typed')) return 'numericMobile';
  if (m.startsWith('Appears more than once')) return 'duplicateInFile';
  if (m.startsWith('The email and the mobile') || m.includes('already used by another account'))
    return 'accountClash';
  if (m.startsWith('This person is already in this school')) return 'roleChange';
  if (error.column === 'mobile') return 'badPhone';
  if (error.column === 'email') return 'badEmail';
  return 'other';
}

/**
 * The staff version of the student import: sample file, column guide, upload,
 * problems, preview, "send invitations now", confirm. A component only —
 * `/staff/import` mounts it. Nothing is written until the person confirms.
 */
export function StaffImportView() {
  const { t } = useTranslation('staffImport');
  const { t: tStaff } = useTranslation('staff');
  const fromWelcome = useSearch({ strict: false }).from === 'welcome';
  const { mutateAsync: validateAsync } = useValidateStaffUpload();
  const { mutateAsync: commitAsync } = useCommitStaffUpload();

  const [sendInvitations, setSendInvitations] = React.useState(true);
  // `commit` is memoised inside BulkUploadPreview's hook; read the box via a
  // ref so toggling it never changes the callback identity.
  const sendRef = React.useRef(sendInvitations);
  sendRef.current = sendInvitations;

  const validate = React.useCallback(
    async (file: File, onProgress: (percent: number) => void): Promise<Result> => {
      const result = await validateAsync({ file, onProgress });
      return {
        ...result,
        errors: result.errors.map((error) => ({
          ...error,
          message: t(`rowErrors.${rowErrorKey(error)}`),
        })),
      };
    },
    [validateAsync, t],
  );
  const commit = React.useCallback(
    (stagingId: string) => commitAsync({ stagingId, sendInvitations: sendRef.current }),
    [commitAsync],
  );

  const roles = IMPORTABLE_ROLES.map((role) => tStaff(`roles.${role}`)).join(', ');

  return (
    <PageContainer>
      <PageHeader title={t('title')} />
      {fromWelcome && (
        <div>
          <Button variant="outline" asChild>
            <Link to="/welcome" search={{ step: 'people' }}>
              {t('backToSetup')}
            </Link>
          </Button>
        </div>
      )}

      <Card padded asChild>
        <section aria-labelledby="staff-import-template-heading">
          <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between md:gap-6">
            <div>
              <h2 id="staff-import-template-heading" className="text-h3">
                {t('template.title')}
              </h2>
              <p className="mt-1 text-text-secondary">{t('template.explanation')}</p>
            </div>
            <Button
              type="button"
              variant="outline"
              className="w-full md:w-auto"
              onClick={() => void downloadStaffTemplate()}
            >
              <DownloadIcon className="size-4" aria-hidden />
              {t('template.download')}
            </Button>
          </div>
          <details className="mt-4 border-t border-border-subtle pt-2" open>
            <summary className="flex min-h-11 cursor-pointer items-center font-medium md:min-h-8">
              {t('guide.toggle')}
            </summary>
            <ul className="divide-y divide-border-subtle">
              {STAFF_COLUMNS.map((column) => (
                <li
                  key={column}
                  className="flex flex-col gap-1 py-3 md:grid md:grid-cols-12 md:gap-4"
                >
                  <span className="font-medium md:col-span-4">{t(`columns.${column}.label`)}</span>
                  <span className="md:col-span-8">{t(`columns.${column}.help`)}</span>
                </li>
              ))}
            </ul>
            <p className="mt-2 font-medium">{t('rules.phoneOrEmail')}</p>
            <p className="mt-1 text-text-secondary">{t('guide.roles', { roles })}</p>
          </details>
        </section>
      </Card>

      <Card padded asChild>
        <section aria-labelledby="staff-import-upload-heading" className="flex flex-col gap-3">
          <div>
            <h2 id="staff-import-upload-heading" className="text-h3">
              {t('upload.title')}
            </h2>
            <p className="mt-1 text-text-secondary">{t('upload.explanation')}</p>
          </div>
          <BulkUploadPreview<StaffUploadSummary, StaffImportResult>
            accept=".csv,.xlsx"
            maxFileSize={MAX_FILE_SIZE}
            validate={validate}
            commit={commit}
            canCommit={(result) =>
              result.hard_error_count === 0 &&
              result.summary.summary.create + result.summary.summary.restore > 0
            }
            renderSummary={(result) => (
              <PreviewSummary
                result={result}
                sendInvitations={sendInvitations}
                onSendInvitationsChange={setSendInvitations}
              />
            )}
            renderDone={(result, reset) => <DoneSummary result={result} onImportAnother={reset} />}
          />
        </section>
      </Card>
    </PageContainer>
  );
}

function PreviewSummary({
  result,
  sendInvitations,
  onSendInvitationsChange,
}: {
  result: Result;
  sendInvitations: boolean;
  onSendInvitationsChange: (value: boolean) => void;
}) {
  const { t } = useTranslation('staffImport');
  const { t: tStaff } = useTranslation('staff');
  const { summary, rows } = result.summary;
  const shown = rows.slice(0, PREVIEW_ROW_LIMIT);
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 font-medium">
        <span>{t('summary.willCreate', { count: summary.create })}</span>
        <span>{t('summary.willRestore', { count: summary.restore })}</span>
        <span>{t('summary.willSkip', { count: summary.skip })}</span>
      </div>
      <label
        htmlFor="staff-import-send-invitations"
        className="flex min-h-11 items-center gap-3 md:min-h-8"
      >
        <Checkbox
          id="staff-import-send-invitations"
          checked={sendInvitations}
          onCheckedChange={(checked) => onSendInvitationsChange(checked === true)}
        />
        {t('sendInvitations')}
      </label>
      {shown.length > 0 && (
        <>
          <table className="w-full text-start">
            <caption className="sr-only">{t('preview.caption')}</caption>
            <thead className="max-md:sr-only">
              <tr className="border-b border-border-subtle">
                {(['name', 'contact', 'role', 'action'] as const).map((column) => (
                  <th key={column} scope="col" className="py-1 pe-4 font-medium">
                    {t(`preview.columns.${column}`)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {shown.map((row) => (
                <tr
                  key={row.row}
                  className="border-b border-border-subtle max-md:flex max-md:flex-col max-md:py-2"
                >
                  <td className="py-1 pe-4 font-medium md:font-normal">{row.name}</td>
                  <td className="py-1 pe-4">{row.mobile ?? row.email}</td>
                  <td className="py-1 pe-4">{tStaff(`roles.${row.role}`)}</td>
                  <td className="py-1">
                    <StatusBadge
                      tone={row.action === 'skip' ? 'neutral' : 'success'}
                      label={t(`action.${row.action}`)}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="text-text-secondary">
            {t('preview.shownOf', { shown: shown.length, total: rows.length })}
          </p>
        </>
      )}
    </div>
  );
}

function DoneSummary({
  result,
  onImportAnother,
}: {
  result: StaffImportResult;
  onImportAnother: () => void;
}) {
  const { t } = useTranslation('staffImport');
  const rowsOf = (list: { row: number }[]) => list.map((item) => item.row).join(', ');
  return (
    <section aria-labelledby="staff-import-result-heading" className="flex flex-col gap-3">
      <h2 id="staff-import-result-heading" className="text-h3">
        {t('done.title')}
      </h2>
      <ul className="flex flex-col gap-1">
        <li>{t('done.created', { count: result.created })}</li>
        {result.restored > 0 && <li>{t('done.restored', { count: result.restored })}</li>}
        <li>{t('done.invited', { count: result.invited })}</li>
        {result.failed.length > 0 && (
          <li role="alert">
            {t('done.failed', { count: result.failed.length })}.{' '}
            {t('done.failedRows', { rows: rowsOf(result.failed) })}
          </li>
        )}
        {result.invite_failed.length > 0 && (
          <li role="alert">{t('done.inviteFailedRows', { rows: rowsOf(result.invite_failed) })}</li>
        )}
      </ul>
      <div className="flex flex-wrap gap-2">
        <Button asChild>
          <Link to="/staff">{t('done.seeStaff')}</Link>
        </Button>
        <Button type="button" variant="ghost" onClick={onImportAnother}>
          {t('done.importAnother')}
        </Button>
      </div>
    </section>
  );
}

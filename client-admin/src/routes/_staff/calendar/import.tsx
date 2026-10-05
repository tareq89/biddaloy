/**
 * [17.5.3] / [31.4] `/calendar/import` — a full-page modal (D23) with two
 * steps: upload a spreadsheet (or arrive pre-loaded from the clone dialog
 * with a staged preview already in hand), then review the row-by-row
 * preview and commit. Nothing writes until "Confirm import" —
 * `validate`/`clone` only stage a preview server-side.
 *
 * Clone hands its result through router state (`Route.useLoaderData`
 * isn't right here — the preview is produced by a mutation the clone
 * dialog fires, not by this route's own loader) via a plain in-memory
 * module ref set immediately before `navigate()`, read once on mount and
 * cleared, mirroring how a `postMessage`-free same-tab handoff usually
 * works in this app when TanStack Router's own `state` isn't a fit for a
 * throwaway payload.
 */
import { Button, Card } from '@biddaloy/ui/components';
import {
  useCommitCalendarImport,
  useValidateCalendarImport,
  type CalendarImportValidateResponse,
} from '@biddaloy/ui/hooks';
import { useTranslation } from '@biddaloy/ui/i18n';
import { FullPageShell } from '@biddaloy/ui/shells';
import { createFileRoute } from '@tanstack/react-router';
import { CircleCheckIcon } from 'lucide-react';
import * as React from 'react';

import { loadRouteNamespaces, swallowUnlessOffline } from '../../../route-loaders';

import { ImportDropzone } from './-import-dropzone';
import { ImportPreviewTable } from './-import-preview-table';

/** Set by `-clone-dialog.tsx`'s caller immediately before navigating here,
 * read once by this route's `component` and cleared. A plain mutable
 * module-level binding can't be `export`ed directly — TanStack Router's
 * code-splitting compiles this file's route config and its component
 * into separate chunks, and Rolldown rejects mutating an imported
 * binding across that split — so it stays private, with `get`/`set`
 * functions as the only access. */
let pendingClonePreviewValue: CalendarImportValidateResponse | undefined;
export function setPendingClonePreview(preview: CalendarImportValidateResponse | undefined) {
  pendingClonePreviewValue = preview;
}
export function getPendingClonePreview(): CalendarImportValidateResponse | undefined {
  return pendingClonePreviewValue;
}

export const Route = createFileRoute('/_staff/calendar/import')({
  // `_staff.tsx` renders this route without the sidebar and header (D22).
  staticData: { chromeless: true },
  loader: () => loadRouteNamespaces('calendarImport', 'common').catch(swallowUnlessOffline),
  component: CalendarImportPage,
});

type WizardState =
  | { step: 'upload' }
  | { step: 'preview'; result: CalendarImportValidateResponse; fileName?: string }
  | { step: 'done'; created: number; updated: number; published: boolean };

function StepHeading({
  current,
  title,
  fileName,
}: {
  current: number;
  title: string;
  fileName?: string | undefined;
}) {
  const { t } = useTranslation('calendarImport');
  return (
    <div>
      <p className="text-label text-text-secondary">{t('stepOf', { current, total: 2 })}</p>
      <h2 className="text-h2">{title}</h2>
      {fileName && (
        <p className="mt-0.5 text-text-secondary">{t('step2.fileName', { name: fileName })}</p>
      )}
    </div>
  );
}

function CalendarImportPage() {
  const { t } = useTranslation('calendarImport');
  const navigate = Route.useNavigate();

  const [state, setState] = React.useState<WizardState>(() => {
    const preview = getPendingClonePreview();
    return preview ? { step: 'preview', result: preview } : { step: 'upload' };
  });
  React.useEffect(() => {
    setPendingClonePreview(undefined);
  }, []);

  const [selectedFile, setSelectedFile] = React.useState<File | undefined>(undefined);
  const [allowPartial, setAllowPartial] = React.useState(false);
  const [publishImmediately, setPublishImmediately] = React.useState(false);
  const [uploadError, setUploadError] = React.useState<string | undefined>(undefined);

  const validateMutation = useValidateCalendarImport();
  const commitMutation = useCommitCalendarImport();

  // A pending request must not be abandoned by Close / Esc / Cancel.
  const busy = validateMutation.isPending || commitMutation.isPending;
  const close = () => {
    if (!busy) void navigate({ to: '/calendar' });
  };

  function handleValidate() {
    if (!selectedFile) return;
    setUploadError(undefined);
    validateMutation.mutate(selectedFile, {
      onSuccess: (result) => {
        setAllowPartial(false);
        setState({ step: 'preview', result, fileName: selectedFile.name });
      },
      onError: () => setUploadError(t('step1.uploadFailed')),
    });
  }

  function handleCommit() {
    if (state.step !== 'preview') return;
    commitMutation.mutate(
      { staging_id: state.result.staging_id, publish: publishImmediately },
      {
        onSuccess: (result) => {
          setState({
            step: 'done',
            created: result.created,
            updated: result.updated,
            published: publishImmediately,
          });
        },
      },
    );
  }

  if (state.step === 'upload') {
    return (
      <FullPageShell
        title={t('pageTitle')}
        size="wide"
        onClose={close}
        secondary={{ label: t('clone.cancel'), onClick: close }}
        primary={{
          label: t('step1.check'),
          onClick: handleValidate,
          disabled: !selectedFile,
          busy: validateMutation.isPending,
        }}
      >
        <StepHeading current={1} title={t('step1.title')} />
        <ImportDropzone
          onFileChange={(file) => {
            setSelectedFile(file);
            setUploadError(undefined);
          }}
          disabled={validateMutation.isPending}
          {...(uploadError ? { error: uploadError } : {})}
        />
        {validateMutation.isPending && (
          <p className="text-text-secondary">{t('step1.validating')}</p>
        )}
      </FullPageShell>
    );
  }

  if (state.step === 'preview') {
    const hasErrors = state.result.summary.error > 0;
    const canCommit = !hasErrors || allowPartial;
    return (
      <FullPageShell
        title={t('pageTitle')}
        size="wide"
        dirty
        onClose={close}
        secondary={{
          label: t('step2.back'),
          onClick: () => {
            if (busy) return;
            setSelectedFile(undefined);
            setState({ step: 'upload' });
          },
        }}
        primary={{
          label: commitMutation.isPending ? t('step3.committing') : t('step3.commit'),
          onClick: handleCommit,
          disabled: !canCommit,
          busy: commitMutation.isPending,
        }}
      >
        <StepHeading current={2} title={t('step2.title')} fileName={state.fileName} />
        {commitMutation.isError && (
          <p role="alert" className="text-destructive">
            {t('step3.commitFailed')}
          </p>
        )}
        <ImportPreviewTable
          summary={state.result.summary}
          rows={state.result.rows}
          allowPartial={allowPartial}
          onAllowPartialChange={setAllowPartial}
          publishImmediately={publishImmediately}
          onPublishImmediatelyChange={setPublishImmediately}
        />
      </FullPageShell>
    );
  }

  // state.step === 'done'
  const total = state.created + state.updated;
  return (
    <FullPageShell
      title={t('pageTitle')}
      size="wide"
      onClose={close}
      primary={{ label: t('success.viewOnCalendar'), onClick: close }}
    >
      <Card className="flex flex-col items-center gap-2 px-4 py-10 text-center">
        <span
          aria-hidden="true"
          className="flex size-12 items-center justify-center rounded-full bg-status-paid-bg text-status-paid-fg"
        >
          <CircleCheckIcon className="size-6" />
        </span>
        <h2 className="text-h3">{t('success.title')}</h2>
        <p className="text-text-secondary">
          {state.published
            ? t('success.publishedMessage', { count: total })
            : t('success.draftMessage', { count: total })}
        </p>
        <Button
          type="button"
          variant="outline"
          className="mt-2"
          onClick={() => {
            setSelectedFile(undefined);
            setState({ step: 'upload' });
          }}
        >
          {t('success.importAnother')}
        </Button>
      </Card>
    </FullPageShell>
  );
}

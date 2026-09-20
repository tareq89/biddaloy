/**
 * [17.5.3] `/calendar/import` — 3-step wizard: upload a spreadsheet (or
 * arrive pre-loaded from the clone dialog with a staged preview already
 * in hand), review the row-by-row preview, then commit. Nothing writes
 * until "Commit import" on step 3 — `validate`/`clone` only stage a
 * preview server-side.
 *
 * Clone hands its result through router state (`Route.useLoaderData`
 * isn't right here — the preview is produced by a mutation the clone
 * dialog fires, not by this route's own loader) via a plain in-memory
 * module ref set immediately before `navigate()`, read once on mount and
 * cleared, mirroring how a `postMessage`-free same-tab handoff usually
 * works in this app when TanStack Router's own `state` isn't a fit for a
 * throwaway payload.
 */
import { Button, Checkbox, Label } from '@biddaloy/ui/components';
import {
  useCommitCalendarImport,
  useValidateCalendarImport,
  type CalendarImportValidateResponse,
} from '@biddaloy/ui/hooks';
import { useTranslation } from '@biddaloy/ui/i18n';
import { createFileRoute, Link } from '@tanstack/react-router';
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
  loader: () => loadRouteNamespaces('calendarImport', 'common').catch(swallowUnlessOffline),
  component: CalendarImportPage,
});

type WizardState =
  | { step: 'upload' }
  | { step: 'preview'; result: CalendarImportValidateResponse }
  | { step: 'done'; created: number; updated: number; published: boolean };

function CalendarImportPage() {
  const { t } = useTranslation('calendarImport');

  const [state, setState] = React.useState<WizardState>(() => {
    const preview = getPendingClonePreview();
    return preview ? { step: 'preview', result: preview } : { step: 'upload' };
  });
  React.useEffect(() => {
    setPendingClonePreview(undefined);
  }, []);

  const [allowPartial, setAllowPartial] = React.useState(false);
  const [publishImmediately, setPublishImmediately] = React.useState(false);
  const [uploadError, setUploadError] = React.useState<string | undefined>(undefined);

  const validateMutation = useValidateCalendarImport();
  const commitMutation = useCommitCalendarImport();

  function handleFileSelected(file: File) {
    setUploadError(undefined);
    validateMutation.mutate(file, {
      onSuccess: (result) => {
        setAllowPartial(false);
        setState({ step: 'preview', result });
      },
      onError: (error: unknown) => {
        setUploadError(error instanceof Error ? error.message : t('step1.uploadFailed'));
      },
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
      <div className="mx-auto max-w-2xl space-y-4">
        <h1 className="text-lg font-semibold">{t('pageTitle')}</h1>
        <h2 className="text-base font-medium">{t('step1.title')}</h2>
        <ImportDropzone
          onFileSelected={handleFileSelected}
          disabled={validateMutation.isPending}
          {...(uploadError ? { error: uploadError } : {})}
        />
        {validateMutation.isPending && (
          <p className="text-sm text-muted-foreground">{t('step1.validating')}</p>
        )}
      </div>
    );
  }

  if (state.step === 'preview') {
    const hasErrors = state.result.summary.error > 0;
    const canCommit = !hasErrors || allowPartial;
    return (
      <div className="mx-auto max-w-3xl space-y-4">
        <h1 className="text-lg font-semibold">{t('pageTitle')}</h1>
        <h2 className="text-base font-medium">{t('step2.title')}</h2>

        <ImportPreviewTable
          summary={state.result.summary}
          rows={state.result.rows}
          allowPartial={allowPartial}
          onAllowPartialChange={setAllowPartial}
        />

        <div className="flex items-center gap-2">
          <Checkbox
            id="import-publish-immediately"
            checked={publishImmediately}
            onCheckedChange={(checked) => setPublishImmediately(checked === true)}
          />
          <Label htmlFor="import-publish-immediately">{t('step3.publishImmediately')}</Label>
        </div>
        <p className="text-sm text-muted-foreground">{t('step3.publishImmediatelyHint')}</p>

        <div className="flex gap-2">
          <Button type="button" variant="outline" onClick={() => setState({ step: 'upload' })}>
            {t('step2.back')}
          </Button>
          <Button
            type="button"
            disabled={!canCommit || commitMutation.isPending}
            onClick={handleCommit}
          >
            {commitMutation.isPending ? t('step3.committing') : t('step3.commit')}
          </Button>
        </div>
        {commitMutation.isError && (
          <p className="text-sm text-destructive" role="alert">
            {t('step3.commitFailed')}
          </p>
        )}
      </div>
    );
  }

  // state.step === 'done'
  const total = state.created + state.updated;
  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <h1 className="text-lg font-semibold">{t('success.title')}</h1>
      <p>
        {state.published
          ? t('success.publishedMessage', { count: total })
          : t('success.draftMessage', { count: total })}
      </p>
      <div className="flex gap-2">
        <Button asChild variant="outline">
          <Link to="/calendar">{t('success.viewOnCalendar')}</Link>
        </Button>
        <Button type="button" onClick={() => setState({ step: 'upload' })}>
          {t('success.importAnother')}
        </Button>
      </div>
    </div>
  );
}

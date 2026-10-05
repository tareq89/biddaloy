/**
 * Domain-agnostic "upload → validate → preview → confirm → commit" flow.
 * Any bulk-upload feature (student roster today, backup restore next)
 * plugs in `validate`/`commit`/`renderSummary`/`renderDone` and gets the
 * state machine, the error table, the expiry countdown and the confirm
 * gating for free. Zero student- or backup-specific copy lives here —
 * every string routes through the `bulkImport` i18n namespace.
 */
import { ClockIcon, FileSpreadsheetIcon, RotateCcwIcon } from 'lucide-react';
import * as React from 'react';

import { useBulkUploadPreview, type PreviewResult } from '../hooks/use-bulk-upload-preview';
import { useRegionConfig, useTranslation } from '../i18n';
import { renderDigits } from '../utils/digits';

import { BulkImportErrorTable } from './bulk-import-error-table';
import { Button } from './button';
import { Card } from './card';
import { FileUpload, type FileUploadItem } from './file-upload';

export interface BulkUploadPreviewConfirmSlotApi {
  setBlocked: (blocked: boolean) => void;
}

/** What a host (e.g. a FullPageShell footer) needs to own the Confirm button itself. */
export interface BulkUploadPreviewController<S, C> {
  status: 'idle' | 'uploading' | 'preview' | 'committing' | 'done' | 'failed';
  /** Set in `'preview'` / `'committing'`. */
  result: PreviewResult<S> | undefined;
  /** Set in `'done'`. */
  commitResult: C | undefined;
  confirmDisabled: boolean;
  confirm: () => void;
  reset: () => void;
}

export interface BulkUploadPreviewProps<S, C> {
  accept?: string;
  /** Bytes. Rejected client-side, before anything is sent — surfaces as a
   * local `FileUpload` item error, not a state transition. */
  maxFileSize?: number;
  validate: (file: File, onProgress: (percent: number) => void) => Promise<PreviewResult<S>>;
  commit: (stagingId: string) => Promise<C>;
  /** Extra "is there anything to do" gate on top of `hard_error_count`.
   * Defaults to `hard_error_count === 0`. */
  canCommit?: (result: PreviewResult<S>) => boolean;
  renderSummary: (result: PreviewResult<S>) => React.ReactNode;
  /** An optional extra confirm gate — e.g. a "type DELETE to confirm"
   * input. Call `setBlocked(true)` to disable Confirm regardless of every
   * other condition, `setBlocked(false)` to release that hold. */
  confirmSlot?: (api: BulkUploadPreviewConfirmSlotApi) => React.ReactNode;
  /** Rendered in place of the confirm controls while the commit promise is
   * in flight. Defaults to the existing `t('confirming')` button label. */
  renderCommitting?: (result: PreviewResult<S>) => React.ReactNode;
  renderDone: (commitResult: C, reset: () => void) => React.ReactNode;
  /** Host-owned Confirm: the host stores the controller in state and renders
   * its own footer (e.g. a `FullPageShell` footer) from it. `confirm` and
   * `reset` are stable; the callback fires only when the controller's data
   * (status, result, commitResult, confirmDisabled) changes. */
  onControllerChange?: (controller: BulkUploadPreviewController<S, C>) => void;
  /** The host renders Confirm. Drops the in-card Confirm / Upload-another
   * buttons and the preview's own `Card` frame (the host card frames it),
   * showing a file row with an "upload another" button instead. */
  hideConfirm?: boolean;
}

function formatCountdown(remainingMs: number): string {
  const totalSeconds = Math.max(0, Math.ceil(remainingMs / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

/**
 * True when `accept` is absent (nothing to enforce) or the filename ends in
 * one of its comma-separated extensions. Only extension entries are checked;
 * a MIME-type entry like `text/csv` is left to the picker.
 */
function hasAcceptedExtension(name: string, accept: string | undefined): boolean {
  if (!accept) return true;
  const extensions = accept
    .split(',')
    .map((part) => part.trim().toLowerCase())
    .filter((part) => part.startsWith('.'));
  if (extensions.length === 0) return true;
  const lower = name.toLowerCase();
  return extensions.some((ext) => lower.endsWith(ext));
}

/** The preview's `Card` frame — dropped when the host card already frames it
 * (no nested cards). */
function PreviewFrame({ framed, children }: { framed: boolean; children: React.ReactNode }) {
  return framed ? (
    <Card padded className="flex flex-col gap-4">
      {children}
    </Card>
  ) : (
    <div className="flex flex-col gap-4">{children}</div>
  );
}

export function BulkUploadPreview<S, C>({
  accept,
  maxFileSize,
  validate,
  commit,
  canCommit = (result) => result.hard_error_count === 0,
  renderSummary,
  confirmSlot,
  renderCommitting,
  renderDone,
  onControllerChange,
  hideConfirm = false,
}: BulkUploadPreviewProps<S, C>) {
  const { t } = useTranslation('bulkImport');
  const config = useRegionConfig();
  const { state, selectFile, confirm, reset } = useBulkUploadPreview<S, C>({ validate, commit });

  const [localError, setLocalError] = React.useState<string | undefined>(undefined);
  // `FileUpload` renders by filename/size, but the hook's state machine only
  // carries the server round-trip (progress, result, …) — it has no reason
  // to know about the `File` object itself. Keep the picked file here so the
  // upload/local-error items show the real name instead of a blank one.
  const [selectedFile, setSelectedFile] = React.useState<File | undefined>(undefined);
  // A consumer that supplies a `confirmSlot` is gating Confirm on something
  // only the slot knows (the restore wizard's typed school name, say), so the
  // hold starts ON and the slot has to release it explicitly. Starting it OFF
  // would leave Confirm enabled for the first render + effect flush of every
  // new preview — a window in which a destructive commit is one click away
  // before the gate has had a chance to speak. Consumers with no
  // `confirmSlot` (e.g. students/import) are unaffected: no slot, no hold.
  const hasConfirmSlot = confirmSlot != null;
  const [slotBlocked, setSlotBlocked] = React.useState(hasConfirmSlot);
  const [remainingMs, setRemainingMs] = React.useState<number>(0);

  const expiresAt =
    state.status === 'preview' || state.status === 'committing'
      ? state.result.expires_at
      : undefined;

  // New preview → the confirm-slot hold back to its default (held when
  // there is a slot to release it, released otherwise). This has to happen
  // during render, not in an effect: `confirmSlot`'s own mount effect can
  // release the hold (e.g. an empty-tenant summary that needs no typed
  // confirmation) in the very same commit this preview first appears in,
  // and effects run child-before-parent — an effect here would always run
  // after the slot's and clobber that release right back to blocked.
  // Adjusting state during render (the React-documented pattern for "reset
  // state when a prop changes") sidesteps the ordering entirely, since it
  // happens before any effects run at all.
  const previousExpiresAtRef = React.useRef(expiresAt);
  if (previousExpiresAtRef.current !== expiresAt) {
    previousExpiresAtRef.current = expiresAt;
    setSlotBlocked(hasConfirmSlot);
  }

  React.useEffect(() => {
    if (!expiresAt) {
      setRemainingMs(0);
      return;
    }
    const target = new Date(expiresAt).getTime();
    setRemainingMs(target - Date.now());
    const interval = setInterval(() => {
      setRemainingMs(target - Date.now());
    }, 1000);
    return () => clearInterval(interval);
  }, [expiresAt]);

  function handleFilesSelected(files: File[]) {
    const file = files[0];
    if (!file) return;
    setLocalError(undefined);
    setSelectedFile(file);
    // `accept` on the input is only a hint to the OS file dialog, which
    // lets the user switch it to "All Files" and pick anything. Checking
    // here keeps a wrong-type file from costing a full upload and one of the
    // endpoint's throttle slots. The server re-checks; this is a fail-fast,
    // not the trust boundary.
    if (!hasAcceptedExtension(file.name, accept)) {
      setLocalError(t('fileWrongType'));
      return;
    }
    if (maxFileSize !== undefined && file.size > maxFileSize) {
      setLocalError(t('fileTooLarge'));
      return;
    }
    selectFile(file);
  }

  function handleReset() {
    setLocalError(undefined);
    setSelectedFile(undefined);
    reset();
  }

  const fileItems: FileUploadItem[] = React.useMemo(() => {
    if (state.status === 'uploading' && selectedFile) {
      return [
        {
          id: 'upload',
          file: selectedFile,
          progress: state.progress,
          ...(localError ? { error: localError } : {}),
        },
      ];
    }
    return [];
  }, [state, localError, selectedFile]);

  let statusText = '';
  if (state.status === 'uploading') statusText = t('validating');
  else if (state.status === 'committing') statusText = t('confirming');
  else if (state.status === 'done') statusText = t('done');
  else if (state.status === 'failed') {
    statusText = state.reason === 'expired' ? t('expiredRetry') : state.message;
  }

  const isExpired =
    (state.status === 'preview' || state.status === 'committing') && remainingMs <= 0;

  const confirmDisabled =
    state.status !== 'preview' ||
    state.result.hard_error_count > 0 ||
    !canCommit(state.result) ||
    slotBlocked ||
    isExpired;

  // Latest-ref pattern: the host gets stable `confirm`/`reset` and the effect
  // below re-fires only when the controller's data changes, so a host that
  // stores the controller in state cannot loop.
  const confirmRef = React.useRef(confirm);
  const resetRef = React.useRef(handleReset);
  const onControllerChangeRef = React.useRef(onControllerChange);
  confirmRef.current = confirm;
  resetRef.current = handleReset;
  onControllerChangeRef.current = onControllerChange;
  const stableConfirm = React.useCallback(() => confirmRef.current(), []);
  const stableReset = React.useCallback(() => resetRef.current(), []);
  const result = 'result' in state ? state.result : undefined;
  const commitResult = state.status === 'done' ? state.commitResult : undefined;
  React.useEffect(() => {
    onControllerChangeRef.current?.({
      status: state.status,
      result,
      commitResult,
      confirmDisabled,
      confirm: stableConfirm,
      reset: stableReset,
    });
  }, [state.status, result, commitResult, confirmDisabled, stableConfirm, stableReset]);

  return (
    <div className="flex flex-col gap-4">
      <div aria-live="polite" className="sr-only">
        {statusText}
      </div>

      {(state.status === 'idle' || state.status === 'uploading') && (
        <FileUpload
          aria-label={t('chooseFile')}
          chooseLabel={t('chooseFile')}
          {...(accept ? { accept } : {})}
          multiple={false}
          disabled={state.status === 'uploading'}
          items={
            fileItems.length > 0
              ? fileItems
              : localError && selectedFile
                ? [{ id: 'local-error', file: selectedFile, error: localError }]
                : []
          }
          onFilesSelected={handleFilesSelected}
        />
      )}

      {(state.status === 'preview' || state.status === 'committing') && (
        <PreviewFrame framed={!hideConfirm}>
          {hideConfirm && (
            <div className="flex flex-wrap items-center gap-3 rounded-md border border-border-subtle p-3 md:flex-nowrap">
              <div className="flex size-10 shrink-0 items-center justify-center rounded-md bg-muted text-text-secondary">
                <FileSpreadsheetIcon aria-hidden="true" />
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate font-medium">{selectedFile?.name}</p>
                {state.status === 'committing' && (
                  <p className="text-caption text-text-secondary">{t('confirming')}</p>
                )}
              </div>
              <Button
                type="button"
                variant="ghost"
                className="w-full md:w-auto"
                onClick={handleReset}
              >
                <RotateCcwIcon aria-hidden="true" />
                {t('uploadAnother')}
              </Button>
            </div>
          )}

          <div>{renderSummary(state.result)}</div>

          {state.result.errors.length > 0 && <BulkImportErrorTable errors={state.result.errors} />}

          <p className="flex items-center gap-1 text-caption text-text-secondary">
            <ClockIcon className="size-3.5" aria-hidden="true" />
            {isExpired
              ? t('expired')
              : t('expiresIn', {
                  time: renderDigits(formatCountdown(remainingMs), config.numerals),
                })}
          </p>

          {state.status === 'committing' && renderCommitting ? (
            renderCommitting(state.result)
          ) : (
            <>
              {confirmSlot?.({ setBlocked: setSlotBlocked })}

              {!hideConfirm && (
                <div className="flex items-center gap-2">
                  <Button type="button" onClick={confirm} disabled={confirmDisabled}>
                    {state.status === 'committing' ? t('confirming') : t('confirm')}
                  </Button>
                  <Button type="button" variant="outline" onClick={handleReset}>
                    {t('uploadAnother')}
                  </Button>
                </div>
              )}
            </>
          )}
        </PreviewFrame>
      )}

      {state.status === 'done' && renderDone(state.commitResult, handleReset)}

      {state.status === 'failed' && (
        <Card padded className="flex flex-col gap-3">
          <p role="alert" className="text-destructive">
            {state.reason === 'expired' ? t('expiredRetry') : state.message}
          </p>
          <div>
            <Button type="button" variant="outline" onClick={handleReset}>
              {t('uploadAnother')}
            </Button>
          </div>
        </Card>
      )}
    </div>
  );
}

export type { PreviewResult };

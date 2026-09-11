/**
 * State machine behind `BulkUploadPreview` — pick a file, validate it
 * server-side, show the caller what will happen, confirm, commit. Fully
 * caller-agnostic: `validate`/`commit` are passed in as plain promises, so
 * this hook has no opinion on how the request is made (axios, fetch,
 * react-query mutation, …) and can't be reused for state a query cache
 * should own.
 */
import * as React from 'react';

/**
 * Hand-declared to mirror `BulkImportErrorDto` at
 * `server/src/modules/bulk-import/dto/bulk-import.dto.ts:8-30`. The
 * `bulk-import` module has no controller yet (only `ImportStagingService`),
 * so Swagger emits nothing for it and `components['schemas']['BulkImportErrorDto']`
 * doesn't exist in `ui/src/api/schema.d.ts`. Swap this for the generated
 * type once a real validate endpoint lands — do not add fields beyond the
 * DTO in the meantime.
 */
export interface BulkImportError {
  row: number;
  column: string | null;
  message: string;
  severity: 'error' | 'warning';
  value?: string;
  tab?: string;
}

export interface PreviewResult<S> {
  staging_id: string;
  /** ISO 8601 timestamp. */
  expires_at: string;
  errors: BulkImportError[];
  hard_error_count: number;
  summary: S;
}

export type BulkUploadPreviewState<S, C> =
  | { status: 'idle' }
  | { status: 'uploading'; progress: number }
  | { status: 'preview'; result: PreviewResult<S> }
  | { status: 'committing'; result: PreviewResult<S> }
  | { status: 'done'; commitResult: C }
  | { status: 'failed'; reason: 'expired' | 'error'; message: string };

type Action<S, C> =
  | { type: 'select' }
  | { type: 'progress'; progress: number }
  | { type: 'preview'; result: PreviewResult<S> }
  | { type: 'validateFailed'; message: string }
  | { type: 'commit' }
  | { type: 'done'; commitResult: C }
  | { type: 'commitFailed'; reason: 'expired' | 'error'; message: string }
  | { type: 'reset' };

function reducer<S, C>(
  state: BulkUploadPreviewState<S, C>,
  action: Action<S, C>,
): BulkUploadPreviewState<S, C> {
  switch (action.type) {
    case 'select':
      return { status: 'uploading', progress: 0 };
    case 'progress':
      return state.status === 'uploading'
        ? { status: 'uploading', progress: action.progress }
        : state;
    case 'preview':
      return { status: 'preview', result: action.result };
    case 'validateFailed':
      return { status: 'failed', reason: 'error', message: action.message };
    case 'commit':
      return state.status === 'preview' ? { status: 'committing', result: state.result } : state;
    case 'done':
      return { status: 'done', commitResult: action.commitResult };
    case 'commitFailed':
      return { status: 'failed', reason: action.reason, message: action.message };
    case 'reset':
      return { status: 'idle' };
    default:
      return state;
  }
}

function extractHttpStatus(err: unknown): number | undefined {
  // Read defensively: `commit` is caller-supplied and may reject with an
  // axios error (`err.response.status`), a fetch-style error
  // (`err.status`), or something else entirely.
  const asRecord = err as { response?: { status?: number }; status?: number } | undefined;
  return asRecord?.response?.status ?? asRecord?.status;
}

function extractMessage(err: unknown, fallback: string): string {
  if (err instanceof Error && err.message) return err.message;
  if (typeof err === 'string' && err) return err;
  return fallback;
}

export interface UseBulkUploadPreviewOptions<S, C> {
  validate: (file: File, onProgress: (percent: number) => void) => Promise<PreviewResult<S>>;
  commit: (stagingId: string) => Promise<C>;
}

export interface UseBulkUploadPreviewResult<S, C> {
  state: BulkUploadPreviewState<S, C>;
  selectFile: (file: File) => void;
  confirm: () => void;
  reset: () => void;
}

export function useBulkUploadPreview<S, C>({
  validate,
  commit,
}: UseBulkUploadPreviewOptions<S, C>): UseBulkUploadPreviewResult<S, C> {
  const [state, dispatch] = React.useReducer(
    reducer<S, C>,
    { status: 'idle' } as BulkUploadPreviewState<S, C>,
  );

  // Bumped on every `selectFile`/`confirm`/`reset` — a settling promise
  // (or a late `onProgress`) compares its captured id against this ref and
  // no-ops if stale, so a `reset()` mid-flight can't have an old
  // `validate`/`commit` resurrect a state the user already left.
  const attemptId = React.useRef(0);

  const selectFile = React.useCallback(
    (file: File) => {
      const myAttempt = ++attemptId.current;
      dispatch({ type: 'select' });
      validate(file, (percent) => {
        if (attemptId.current !== myAttempt) return;
        dispatch({ type: 'progress', progress: percent });
      })
        .then((result) => {
          if (attemptId.current !== myAttempt) return;
          dispatch({ type: 'preview', result });
        })
        .catch((err: unknown) => {
          if (attemptId.current !== myAttempt) return;
          dispatch({ type: 'validateFailed', message: extractMessage(err, 'Upload failed') });
        });
    },
    [validate],
  );

  const confirm = React.useCallback(() => {
    if (state.status !== 'preview') return;
    const myAttempt = ++attemptId.current;
    const { staging_id } = state.result;
    dispatch({ type: 'commit' });
    commit(staging_id)
      .then((commitResult) => {
        if (attemptId.current !== myAttempt) return;
        dispatch({ type: 'done', commitResult });
      })
      .catch((err: unknown) => {
        if (attemptId.current !== myAttempt) return;
        const httpStatus = extractHttpStatus(err);
        const reason = httpStatus === 404 || httpStatus === 410 ? 'expired' : 'error';
        dispatch({ type: 'commitFailed', reason, message: extractMessage(err, 'Commit failed') });
      });
  }, [commit, state]);

  const reset = React.useCallback(() => {
    ++attemptId.current;
    dispatch({ type: 'reset' });
  }, []);

  return { state, selectFile, confirm, reset };
}

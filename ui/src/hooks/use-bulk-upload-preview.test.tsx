import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { useBulkUploadPreview, type PreviewResult } from './use-bulk-upload-preview';

interface Summary {
  totalRows: number;
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const RESULT: PreviewResult<Summary> = {
  staging_id: 'staging-1',
  expires_at: new Date(Date.now() + 60_000).toISOString(),
  errors: [],
  hard_error_count: 0,
  summary: { totalRows: 10 },
};

describe('useBulkUploadPreview', () => {
  it('goes idle -> uploading -> preview, reflecting onProgress values', async () => {
    const validateDeferred = deferred<PreviewResult<Summary>>();
    const validate = vi.fn((_file: File, onProgress: (p: number) => void) => {
      onProgress(0);
      setTimeout(() => onProgress(50), 0);
      return validateDeferred.promise;
    });
    const { result } = renderHook(() => useBulkUploadPreview({ validate, commit: vi.fn() }));

    expect(result.current.state).toEqual({ status: 'idle' });

    act(() => {
      result.current.selectFile(new File(['x'], 'a.csv'));
    });
    expect(result.current.state).toEqual({ status: 'uploading', progress: 0 });

    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
    expect(result.current.state).toEqual({ status: 'uploading', progress: 50 });

    await act(async () => {
      validateDeferred.resolve(RESULT);
      await validateDeferred.promise;
    });
    expect(result.current.state).toEqual({ status: 'preview', result: RESULT });
  });

  it('goes preview -> committing -> done', async () => {
    const commitDeferred = deferred<{ ok: true }>();
    const validate = vi.fn().mockResolvedValue(RESULT);
    const commit = vi.fn().mockReturnValue(commitDeferred.promise);
    const { result } = renderHook(() => useBulkUploadPreview({ validate, commit }));

    await act(async () => {
      result.current.selectFile(new File(['x'], 'a.csv'));
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(result.current.state.status).toBe('preview');

    act(() => {
      result.current.confirm();
    });
    expect(result.current.state).toEqual({ status: 'committing', result: RESULT });
    expect(commit).toHaveBeenCalledWith('staging-1');

    await act(async () => {
      commitDeferred.resolve({ ok: true });
      await commitDeferred.promise;
    });
    expect(result.current.state).toEqual({ status: 'done', commitResult: { ok: true } });
  });

  it('a validate rejection goes to failed/error', async () => {
    const validate = vi.fn().mockRejectedValue(new Error('bad file'));
    const { result } = renderHook(() => useBulkUploadPreview({ validate, commit: vi.fn() }));

    await act(async () => {
      result.current.selectFile(new File(['x'], 'a.csv'));
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(result.current.state).toEqual({ status: 'failed', reason: 'error', message: 'bad file' });
  });

  it('commit rejected with a 410 (axios-shaped) or 404 goes to failed/expired', async () => {
    const validate = vi.fn().mockResolvedValue(RESULT);

    const commit410 = vi.fn().mockRejectedValue({ response: { status: 410 } });
    const hook410 = renderHook(() => useBulkUploadPreview({ validate, commit: commit410 }));
    await act(async () => {
      hook410.result.current.selectFile(new File(['x'], 'a.csv'));
      await Promise.resolve();
      await Promise.resolve();
    });
    await act(async () => {
      hook410.result.current.confirm();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(hook410.result.current.state.status).toBe('failed');
    expect((hook410.result.current.state as { reason?: string }).reason).toBe('expired');

    const commit404 = vi.fn().mockRejectedValue({ status: 404 });
    const hook404 = renderHook(() => useBulkUploadPreview({ validate, commit: commit404 }));
    await act(async () => {
      hook404.result.current.selectFile(new File(['x'], 'a.csv'));
      await Promise.resolve();
      await Promise.resolve();
    });
    await act(async () => {
      hook404.result.current.confirm();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect((hook404.result.current.state as { reason?: string }).reason).toBe('expired');
  });

  it('commit rejected with a 500 goes to failed/error', async () => {
    const validate = vi.fn().mockResolvedValue(RESULT);
    const commit = vi.fn().mockRejectedValue({ response: { status: 500 } });
    const { result } = renderHook(() => useBulkUploadPreview({ validate, commit }));

    await act(async () => {
      result.current.selectFile(new File(['x'], 'a.csv'));
      await Promise.resolve();
      await Promise.resolve();
    });
    await act(async () => {
      result.current.confirm();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect((result.current.state as { reason?: string }).reason).toBe('error');
  });

  it('reset() returns to idle, and a validate settling after reset does not resurrect preview', async () => {
    const validateDeferred = deferred<PreviewResult<Summary>>();
    const validate = vi.fn().mockReturnValue(validateDeferred.promise);
    const { result } = renderHook(() => useBulkUploadPreview({ validate, commit: vi.fn() }));

    act(() => {
      result.current.selectFile(new File(['x'], 'a.csv'));
    });
    expect(result.current.state.status).toBe('uploading');

    act(() => {
      result.current.reset();
    });
    expect(result.current.state).toEqual({ status: 'idle' });

    await act(async () => {
      validateDeferred.resolve(RESULT);
      await validateDeferred.promise;
    });
    expect(result.current.state).toEqual({ status: 'idle' });
  });
});

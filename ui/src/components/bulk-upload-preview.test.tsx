import { fireEvent, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type * as React from 'react';
import { describe, expect, it, vi } from 'vitest';

import { type BulkImportError, type PreviewResult } from '../hooks/use-bulk-upload-preview';
import { renderWithProviders } from '../test/render-with-providers';

import { BulkUploadPreview } from './bulk-upload-preview';

interface Summary {
  totalRows: number;
}

interface CommitResult {
  processedCount: number;
}

function makeFile(): File {
  return new File(['content'], 'upload.csv', { type: 'text/csv' });
}

function renderSummary(result: PreviewResult<Summary>) {
  return <p>{result.summary.totalRows} rows</p>;
}

function renderDone(result: CommitResult) {
  return <p>done: {result.processedCount}</p>;
}

function baseResult(overrides: Partial<PreviewResult<Summary>> = {}): PreviewResult<Summary> {
  return {
    staging_id: 'staging-1',
    expires_at: new Date(Date.now() + 60_000).toISOString(),
    errors: [],
    hard_error_count: 0,
    summary: { totalRows: 5 },
    ...overrides,
  };
}

// DEFAULT_LOCALE is 'bn' (`locale-storage.ts`); every render here forces
// 'en' so assertions can match plain English copy — same idiom as
// `change-password-form.test.tsx`.
async function renderPreview(
  props: Partial<React.ComponentProps<typeof BulkUploadPreview<Summary, CommitResult>>> = {},
) {
  const { canCommit, confirmSlot, ...rest } = props;
  const result = renderWithProviders(
    <BulkUploadPreview<Summary, CommitResult>
      validate={rest.validate ?? vi.fn().mockResolvedValue(baseResult())}
      commit={rest.commit ?? vi.fn()}
      renderSummary={rest.renderSummary ?? renderSummary}
      renderDone={rest.renderDone ?? renderDone}
      {...(canCommit ? { canCommit } : {})}
      {...(confirmSlot ? { confirmSlot } : {})}
      {...(rest.accept ? { accept: rest.accept } : {})}
    />,
    { locale: 'en' },
  );
  await result.localeReady;
  return result;
}

async function selectFile() {
  const user = userEvent.setup();
  const input = await screen.findByLabelText('Choose file');
  await user.upload(input, makeFile());
}

describe('BulkUploadPreview', () => {
  it('disables Confirm when hard_error_count > 0, enables it on a clean preview', async () => {
    const errors: BulkImportError[] = [{ row: 1, column: 'x', message: 'bad', severity: 'error' }];
    const validate = vi.fn().mockResolvedValue(baseResult({ errors, hard_error_count: 1 }));
    await renderPreview({ validate });

    await selectFile();
    const confirmButton = await screen.findByRole('button', { name: 'Confirm' });
    expect(confirmButton.hasAttribute('disabled')).toBe(true);
  });

  it('enables Confirm on a clean preview', async () => {
    const validate = vi.fn().mockResolvedValue(baseResult());
    await renderPreview({ validate });

    await selectFile();
    const confirmButton = await screen.findByRole('button', { name: 'Confirm' });
    expect(confirmButton.hasAttribute('disabled')).toBe(false);
  });

  it('canCommit returning false disables Confirm even with zero hard errors', async () => {
    const validate = vi.fn().mockResolvedValue(baseResult());
    await renderPreview({ validate, canCommit: () => false });

    await selectFile();
    const confirmButton = await screen.findByRole('button', { name: 'Confirm' });
    expect(confirmButton.hasAttribute('disabled')).toBe(true);
  });

  it('confirmSlot calling setBlocked(true) disables Confirm; false re-enables it', async () => {
    const validate = vi.fn().mockResolvedValue(baseResult());
    let externalSetBlocked: ((blocked: boolean) => void) | undefined;
    await renderPreview({
      validate,
      confirmSlot: ({ setBlocked }) => {
        externalSetBlocked = setBlocked;
        return null;
      },
    });

    await selectFile();
    const confirmButton = await screen.findByRole('button', { name: 'Confirm' });
    expect(confirmButton.hasAttribute('disabled')).toBe(false);

    externalSetBlocked?.(true);
    await waitFor(() => expect(confirmButton.hasAttribute('disabled')).toBe(true));

    externalSetBlocked?.(false);
    await waitFor(() => expect(confirmButton.hasAttribute('disabled')).toBe(false));
  });

  it('the countdown reaches zero and disables Confirm once expires_at passes', async () => {
    const validate = vi
      .fn()
      .mockResolvedValue(baseResult({ expires_at: new Date(Date.now() + 3000).toISOString() }));
    await renderPreview({ validate });

    await selectFile();
    await screen.findByRole('button', { name: 'Confirm' });

    vi.useFakeTimers({ shouldAdvanceTime: true });
    await vi.advanceTimersByTimeAsync(4000);
    vi.useRealTimers();

    const confirmButton = await screen.findByRole('button', { name: 'Confirm' });
    await waitFor(() => expect(confirmButton.hasAttribute('disabled')).toBe(true));
    expect(await screen.findByText('This preview has expired')).toBeTruthy();
  });

  it('an expired commit (410) renders the re-upload copy', async () => {
    const validate = vi.fn().mockResolvedValue(baseResult());
    const commit = vi.fn().mockRejectedValue({ response: { status: 410 } });
    await renderPreview({ validate, commit });

    await selectFile();
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Confirm' }));

    expect(await screen.findByRole('alert')).toHaveProperty(
      'textContent',
      'This preview expired — upload again',
    );
  });

  it('carries the progress/status text in an aria-live region', async () => {
    const validate = vi.fn().mockResolvedValue(baseResult());
    const { container } = await renderPreview({ validate });

    const liveRegion = container.querySelector('[aria-live="polite"]');
    expect(liveRegion).toBeTruthy();

    await selectFile();
    await screen.findByRole('button', { name: 'Confirm' });
    expect(liveRegion?.textContent).toBe('');
  });

  it('renders the error table with a tab column only when some error has tab, and shows CSV export', async () => {
    const errors: BulkImportError[] = [
      { row: 1, column: 'x', message: 'bad', severity: 'error', tab: 'Sheet1' },
    ];
    const validate = vi.fn().mockResolvedValue(baseResult({ errors, hard_error_count: 1 }));
    await renderPreview({ validate });

    await selectFile();
    await screen.findByText('Rows with problems');
    expect(screen.getByText('Sheet1')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Export errors as CSV' })).toBeTruthy();
  });

  it('omits the tab column when no error carries a tab', async () => {
    const errors: BulkImportError[] = [{ row: 1, column: 'x', message: 'bad', severity: 'error' }];
    const validate = vi.fn().mockResolvedValue(baseResult({ errors, hard_error_count: 1 }));
    await renderPreview({ validate });

    await selectFile();
    await screen.findByText('Rows with problems');
    expect(screen.queryByText('Sheet')).toBeNull();
  });

  it('rejects a file whose extension is not in `accept`, without uploading', async () => {
    // Fires `change` directly rather than going through `user.upload`:
    // jsdom enforces `accept` strictly, but a real OS dialog lets the user
    // switch to "All Files" and pick anything, which is the case guarded
    // against here — a .pdf would otherwise cost a full upload and one of
    // the endpoint's throttle slots before the server answered.
    const validate = vi.fn();
    await renderPreview({ accept: '.csv,.xlsx', validate });

    const input = await screen.findByLabelText('Choose file');
    const pdf = new File(['x'], 'notes.pdf', { type: 'application/pdf' });
    Object.defineProperty(input, 'files', { value: [pdf], configurable: true });
    fireEvent.change(input);

    expect(await screen.findByText(/file type isn't supported/i)).toBeTruthy();
    expect(validate).not.toHaveBeenCalled();
  });

  it('accepts a file matching `accept` and validates it', async () => {
    const validate = vi.fn().mockResolvedValue(baseResult());
    await renderPreview({ accept: '.csv,.xlsx', validate });
    await selectFile();

    await waitFor(() => expect(validate).toHaveBeenCalledTimes(1));
  });
});

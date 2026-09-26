import { i18n } from '@biddaloy/ui/i18n';
import { renderWithProviders } from '@biddaloy/ui/test';
import { act, fireEvent, screen } from '@testing-library/react';
import type * as React from 'react';
import { describe, expect, it, vi } from 'vitest';

import { FileUploadWidget, MAX_FILES, MAX_FILE_BYTES } from './file-upload-widget';

function makeFile(name: string, type: string, size: number): File {
  const file = new File(['x'.repeat(Math.min(size, 10))], name, { type });
  Object.defineProperty(file, 'size', { value: size });
  return file;
}

/** Preloads the `homework` namespace before mounting — see
 * `attendance-status-control.test.tsx` for why this is needed: without
 * it the component's `useTranslation('homework')` suspends and an
 * immediate assertion races the Suspense fallback. */
async function renderInEnglish(ui: React.ReactElement) {
  const view = renderWithProviders(ui, { locale: 'en' });
  await act(async () => {
    await view.localeReady;
    await i18n.loadNamespaces('homework');
  });
  return view;
}

function selectFiles(files: File[]) {
  const input = screen.getByLabelText('Choose attachment files');
  fireEvent.change(input, { target: { files } });
}

describe('FileUploadWidget', () => {
  it('accepts a valid PDF/jpg/png/webp file', async () => {
    const onFilesSelected = vi.fn();
    await renderInEnglish(<FileUploadWidget onFilesSelected={onFilesSelected} />);

    const file = makeFile('homework.pdf', 'application/pdf', 1024);
    selectFiles([file]);

    expect(onFilesSelected).toHaveBeenCalledWith([file]);
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('rejects a file of the wrong type', async () => {
    const onFilesSelected = vi.fn();
    await renderInEnglish(<FileUploadWidget onFilesSelected={onFilesSelected} />);

    selectFiles([makeFile('video.mp4', 'video/mp4', 1024)]);

    expect(screen.getByText(/only pdf, jpg, png or webp/i)).toBeTruthy();
    expect(onFilesSelected).toHaveBeenCalledWith([]);
  });

  it('rejects a file over the 5MB cap', async () => {
    const onFilesSelected = vi.fn();
    await renderInEnglish(<FileUploadWidget onFilesSelected={onFilesSelected} />);

    selectFiles([makeFile('big.png', 'image/png', MAX_FILE_BYTES + 1)]);

    expect(screen.getByText(/5mb or smaller/i)).toBeTruthy();
    expect(onFilesSelected).toHaveBeenCalledWith([]);
  });

  it('enforces the 10-file cap across existing + newly picked files', async () => {
    const onFilesSelected = vi.fn();
    const existingFiles = Array.from({ length: 8 }, (_, i) => ({
      storage_key: `k${i}`,
      filename: `existing-${i}.pdf`,
      size: 100,
    }));
    await renderInEnglish(
      <FileUploadWidget existingFiles={existingFiles} onFilesSelected={onFilesSelected} />,
    );

    const files = Array.from({ length: 4 }, (_, i) =>
      makeFile(`new-${i}.pdf`, 'application/pdf', 100),
    );
    selectFiles(files);

    // 8 existing + 4 new = 12, only 2 slots remain (MAX_FILES=10)
    expect(onFilesSelected).toHaveBeenCalledWith(files.slice(0, MAX_FILES - existingFiles.length));
    expect(screen.getAllByText(new RegExp(`only ${MAX_FILES} files`, 'i')).length).toBeGreaterThan(
      0,
    );
  });

  it('does not let an earlier rejected pick shrink capacity for a later valid drop', async () => {
    const onFilesSelected = vi.fn();
    await renderInEnglish(<FileUploadWidget onFilesSelected={onFilesSelected} />);

    // First drop: 1 wrong-type file, kept in `items` as an errored entry.
    selectFiles([makeFile('video.mp4', 'video/mp4', 1024)]);
    expect(onFilesSelected).toHaveBeenLastCalledWith([]);

    // Second drop: 2 valid files. Capacity must be based on valid items
    // only (0), not `items.length` (1), so both should be accepted.
    const validFiles = [
      makeFile('a.pdf', 'application/pdf', 100),
      makeFile('b.pdf', 'application/pdf', 100),
    ];
    selectFiles(validFiles);

    expect(onFilesSelected).toHaveBeenLastCalledWith(validFiles);
  });

  it('disables the picker and existing-file removal when disabled', async () => {
    const onRemoveExisting = vi.fn();
    await renderInEnglish(
      <FileUploadWidget
        existingFiles={[{ storage_key: 'k1', filename: 'a.pdf', size: 10 }]}
        onFilesSelected={vi.fn()}
        onRemoveExisting={onRemoveExisting}
        disabled
      />,
    );

    expect(screen.getByLabelText('Choose attachment files').hasAttribute('disabled')).toBe(true);
    expect(screen.getByRole('button', { name: 'Choose files' }).hasAttribute('disabled')).toBe(
      true,
    );
    expect(screen.getByRole('button', { name: 'Remove a.pdf' }).hasAttribute('disabled')).toBe(
      true,
    );
  });
});

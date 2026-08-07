import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { FileUpload, type FileUploadItem } from './file-upload';

function makeFile(name: string, content = 'content'): File {
  return new File([content], name, { type: 'text/csv' });
}

describe('FileUpload', () => {
  it('is axe clean with no files selected', async () => {
    const { container } = render(
      <FileUpload aria-label="Attachments" items={[]} onFilesSelected={vi.fn()} />,
    );
    await expect(container).toHaveNoViolations();
  });

  it('selecting a file calls onFilesSelected and announces the selection count', async () => {
    const user = userEvent.setup();
    const onFilesSelected = vi.fn();
    render(<FileUpload aria-label="Attachments" items={[]} onFilesSelected={onFilesSelected} />);

    const input = screen.getByLabelText('Attachments');
    const file = makeFile('roster.csv');
    await user.upload(input, file);

    expect(onFilesSelected).toHaveBeenCalledWith([file]);
    await waitFor(() => expect(screen.getByText('1 file selected')).toBeTruthy());
  });

  it('selecting multiple files announces the plural form', async () => {
    const user = userEvent.setup();
    render(<FileUpload aria-label="Attachments" items={[]} onFilesSelected={vi.fn()} multiple />);
    await user.upload(screen.getByLabelText('Attachments'), [makeFile('a.csv'), makeFile('b.csv')]);
    await waitFor(() => expect(screen.getByText('2 files selected')).toBeTruthy());
  });

  it('shows per-file progress', () => {
    const items: FileUploadItem[] = [{ file: makeFile('roster.csv'), progress: 42 }];
    render(<FileUpload aria-label="Attachments" items={items} onFilesSelected={vi.fn()} />);
    expect(screen.getByText('42%')).toBeTruthy();
  });

  it('shows a per-file error via role=alert rather than a silent failure', () => {
    const items: FileUploadItem[] = [{ file: makeFile('roster.csv'), error: 'File too large' }];
    render(<FileUpload aria-label="Attachments" items={items} onFilesSelected={vi.fn()} />);
    expect(screen.getByRole('alert').textContent).toBe('File too large');
  });

  it('shows "Done" once a file reaches 100%', () => {
    const items: FileUploadItem[] = [{ file: makeFile('roster.csv'), progress: 100 }];
    render(<FileUpload aria-label="Attachments" items={items} onFilesSelected={vi.fn()} />);
    expect(screen.getByText('Done')).toBeTruthy();
  });

  it('removing a file calls onRemove with that file', async () => {
    const user = userEvent.setup();
    const onRemove = vi.fn();
    const file = makeFile('roster.csv');
    render(
      <FileUpload
        aria-label="Attachments"
        items={[{ file }]}
        onFilesSelected={vi.fn()}
        onRemove={onRemove}
      />,
    );
    await user.click(screen.getByRole('button', { name: 'Remove roster.csv' }));
    expect(onRemove).toHaveBeenCalledWith(file);
  });

  it('clearing the selection without picking a file does not call onFilesSelected or announce anything', () => {
    const onFilesSelected = vi.fn();
    render(<FileUpload aria-label="Attachments" items={[]} onFilesSelected={onFilesSelected} />);
    const input = screen.getByLabelText('Attachments');
    // Firing a plain change event with no files, as a browser does when a
    // native file picker is dismissed without choosing anything.
    input.dispatchEvent(new Event('change', { bubbles: true }));
    expect(onFilesSelected).not.toHaveBeenCalled();
    expect(screen.queryByText(/selected$/)).toBeNull();
  });

  it('renders duplicate filenames as distinct items with no React key collision', async () => {
    // Two different files that happen to share a name — picked from two
    // different folders, say. `file.name` alone would collide as a React
    // key; React warns loudly (`console.error`) the moment that happens,
    // so absence of that warning is the direct proof, not just that the
    // UI happens to look right.
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    const user = userEvent.setup();
    const fileA = makeFile('photo.jpg', 'first');
    const fileB = makeFile('photo.jpg', 'second');
    const onRemove = vi.fn();
    render(
      <FileUpload
        aria-label="Attachments"
        items={[
          { file: fileA, progress: 50 },
          { file: fileB, progress: 90 },
        ]}
        onFilesSelected={vi.fn()}
        onRemove={onRemove}
      />,
    );

    expect(screen.getByText('50%')).toBeTruthy();
    expect(screen.getByText('90%')).toBeTruthy();

    const [firstRemoveButton, secondRemoveButton] = screen.getAllByRole('button', {
      name: 'Remove photo.jpg',
    });
    expect(firstRemoveButton).toBeTruthy();
    if (!secondRemoveButton) throw new Error('expected two "Remove photo.jpg" buttons');
    await user.click(secondRemoveButton);
    expect(onRemove).toHaveBeenCalledWith(fileB);

    const keyWarning = consoleError.mock.calls.some((call) => String(call[0]).includes('same key'));
    expect(keyWarning).toBe(false);
    consoleError.mockRestore();
  });

  it('the button label is singular for a single-file uploader, and a custom chooseLabel overrides both', () => {
    const { rerender } = render(
      <FileUpload aria-label="Attachments" items={[]} onFilesSelected={vi.fn()} multiple={false} />,
    );
    expect(screen.getByRole('button', { name: 'Choose file' })).toBeTruthy();

    rerender(
      <FileUpload
        aria-label="Attachments"
        items={[]}
        onFilesSelected={vi.fn()}
        multiple
        chooseLabel="Attach files"
      />,
    );
    expect(screen.getByRole('button', { name: 'Attach files' })).toBeTruthy();
  });
});

import { File as NodeFile } from 'node:buffer';

import { cleanupTestState, renderWithRouter, server } from '@biddaloy/ui/test';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { afterEach, describe, expect, it } from 'vitest';

import { routeTree } from '../../../../routeTree.gen';

/**
 * [22.4.4]'s validate-then-confirm homework import page. Follows the same
 * `BulkUploadPreview` shell as `/students/import`; only the page-specific
 * bits are asserted here — the confirm/expire/error-table plumbing itself
 * is covered by `bulk-upload-preview.test.tsx`.
 *
 * Files are constructed with node:buffer's `File`, not jsdom's — jsdom
 * 30's Blob hangs MSW's XHR body serialization (the request never
 * resolves).
 */
function makeFile(name: string, content = 'a,b', type = 'text/csv'): File {
  return new NodeFile([content], name, { type }) as File;
}

function captureDownloads(): { blob: () => Blob | undefined } {
  let captured: Blob | undefined;
  URL.createObjectURL = (blob: Blob) => {
    captured = blob;
    return 'blob:capture';
  };
  URL.revokeObjectURL = () => {};
  return { blob: () => captured };
}

function restoreDownloads(): void {
  delete (URL as { createObjectURL?: unknown }).createObjectURL;
  delete (URL as { revokeObjectURL?: unknown }).revokeObjectURL;
}

function renderImportPage(role = 'ADMIN') {
  return renderWithRouter(routeTree, {
    initialEntries: ['/academics/homework/import'],
    tenantId: 'tenant-1',
    role,
    locale: 'en',
  });
}

async function uploadFile(file: File) {
  const user = userEvent.setup({ applyAccept: false });
  await user.click(await screen.findByRole('button', { name: 'Choose file' }));
  const input = screen.getByLabelText('Choose file');
  await user.upload(input, file);
}

function validateHandler(body: object, status = 201) {
  return http.post('/api/v1/homework/bulk/validate', () => HttpResponse.json(body, { status }));
}

const cleanPreviewBody = {
  staging_id: 'stage-clean',
  expires_at: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
  rows_to_create: 2,
  preview: [
    {
      row: 2,
      class: 'Class 5',
      section: 'A',
      subject: 'Mathematics',
      assigned_date: '2026-10-01',
      due_date: '2026-10-05',
    },
    {
      row: 3,
      class: 'Class 6',
      section: 'B',
      subject: 'Science',
      assigned_date: '2026-10-01',
      due_date: '2026-10-06',
    },
  ],
  errors: [],
  hard_error_count: 0,
};

describe('/academics/homework/import', () => {
  afterEach(async () => {
    restoreDownloads();
    await cleanupTestState();
  });

  it('validates a file, previews rows, then commits on confirm', async () => {
    let commitCalled = false;
    let commitBody: unknown;
    server.use(
      validateHandler(cleanPreviewBody),
      http.post('/api/v1/homework/bulk/commit', async ({ request }) => {
        commitCalled = true;
        commitBody = await request.json();
        return HttpResponse.json(
          {
            total_rows: 2,
            success_count: 2,
            error_count: 0,
            created_homework_ids: ['h1', 'h2'],
            errors: [],
          },
          { status: 201 },
        );
      }),
    );
    renderImportPage();
    await uploadFile(makeFile('homework.csv'));

    await screen.findByText('2 homework will be created.');
    expect(await screen.findByText('Mathematics')).toBeTruthy();
    expect(commitCalled).toBe(false);

    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Confirm' }));

    await screen.findByText('2 homework created.');
    expect(commitCalled).toBe(true);
    expect(commitBody).toEqual({ staging_id: 'stage-clean' });
  });

  it('shows row errors and blocks confirm; never calls commit', async () => {
    let commitCalled = false;
    server.use(
      validateHandler({
        staging_id: 'stage-errors',
        expires_at: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
        rows_to_create: 1,
        preview: [
          {
            row: 2,
            class: 'Class 5',
            section: 'A',
            subject: 'Mathematics',
            assigned_date: '2026-10-01',
            due_date: '2026-10-05',
          },
        ],
        errors: [
          {
            row: 3,
            column: 'due_date',
            message: 'due_date must be a valid date (YYYY-MM-DD)',
            severity: 'error',
          },
        ],
        hard_error_count: 1,
      }),
      http.post('/api/v1/homework/bulk/commit', () => {
        commitCalled = true;
        return HttpResponse.json({}, { status: 201 });
      }),
    );
    renderImportPage();
    await uploadFile(makeFile('homework.csv'));

    await screen.findByText('1 homework will be created.');
    expect(await screen.findByText('due_date must be a valid date (YYYY-MM-DD)')).toBeTruthy();

    const confirmButton = screen.getByRole('button', { name: 'Confirm' });
    expect(confirmButton.hasAttribute('disabled')).toBe(true);
    expect(commitCalled).toBe(false);
  });

  it('offers a downloadable template with the expected header row', async () => {
    const downloads = captureDownloads();
    renderImportPage();

    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Download template' }));

    await waitFor(() => expect(downloads.blob()).toBeDefined());
    const bytes = new Uint8Array(await downloads.blob()!.arrayBuffer());
    expect([bytes[0], bytes[1], bytes[2]]).toEqual([0xef, 0xbb, 0xbf]);
    const csv = new TextDecoder().decode(bytes);
    const headerLine = csv.split('\r\n')[0];
    expect(headerLine).toBe(
      ['class', 'section', 'subject', 'assigned_date', 'due_date', 'description']
        .map((h) => `"${h}"`)
        .join(','),
    );
  });
});

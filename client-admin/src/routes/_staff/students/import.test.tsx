import { File as NodeFile } from 'node:buffer';

import { apiErrorBody, cleanupTestState, renderWithRouter, server } from '@biddaloy/ui/test';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { afterEach, describe, expect, it } from 'vitest';

import { routeTree } from '../../../routeTree.gen';

import { TEMPLATE_HEADERS } from './-import/template';

/**
 * [8.11.7]'s bulk student import page.
 *
 * Files are constructed with node:buffer's `File`, not jsdom's — jsdom
 * 30's Blob hangs MSW's XHR body serialization (the request never
 * resolves). Node's File duck-types everything `userEvent.upload` and
 * axios read.
 */
function makeFile(name: string, content = 'a,b', type = 'text/csv'): File {
  return new NodeFile([content], name, { type }) as unknown as File;
}

/** jsdom implements neither `URL.createObjectURL` nor `revokeObjectURL` —
 * install a capture-and-return stub, and hand back the captured blob.
 * Unpatching happens in `afterEach`, not at the end of the test body: a
 * failed assertion would otherwise leave `URL` monkey-patched for every
 * later test in the worker, turning one failure into a cascade. */
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
    initialEntries: ['/students/import'],
    tenantId: 'tenant-1',
    role,
    locale: 'en',
  });
}

async function uploadFile(file: File) {
  const user = userEvent.setup({ applyAccept: false });
  await user.click(await screen.findByRole('button', { name: 'Choose file' }));
  const input = screen.getByLabelText('Spreadsheet file to import');
  await user.upload(input, file);
}

describe('/students/import', () => {
  afterEach(async () => {
    restoreDownloads();
    await cleanupTestState();
  });

  it('offers a downloadable template with the 13 exact headers, BOM-prefixed', async () => {
    const downloads = captureDownloads();
    renderImportPage();

    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Download template' }));

    await waitFor(() => expect(downloads.blob()).toBeDefined());
    // `Blob.text()` decodes UTF-8 and silently strips a leading BOM, so
    // assert on the raw bytes (EF BB BF) instead.
    const bytes = new Uint8Array(await downloads.blob()!.arrayBuffer());
    expect([bytes[0], bytes[1], bytes[2]]).toEqual([0xef, 0xbb, 0xbf]);
    const csv = new TextDecoder().decode(bytes);
    const headerLine = csv.split('\r\n')[0];
    expect(headerLine).toBe(TEMPLATE_HEADERS.map((h) => `"${h}"`).join(','));
    expect(TEMPLATE_HEADERS).toHaveLength(13);
  });

  it('shows a plain-language column reference before upload', async () => {
    renderImportPage();
    const table = await screen.findByRole('table', { name: 'Column reference' });
    expect(within(table).getByText('student_name')).toBeTruthy();
    expect(within(table).getByText(/Bangladeshi mobile number/)).toBeTruthy();
    expect(within(table).getAllByText('Required')).toHaveLength(5);
  });

  it('rejects a wrong file type client-side with an inline error and fires no request', async () => {
    let requests = 0;
    server.use(
      http.post('/api/v1/students/bulk-upload', () => {
        requests += 1;
        return HttpResponse.json({}, { status: 500 });
      }),
    );
    renderImportPage();
    await uploadFile(makeFile('students.pdf', 'x', 'application/pdf'));

    const error = await screen.findByRole('alert');
    expect(error.textContent).toContain('not supported');
    expect(requests).toBe(0);
  });

  it('rejects a file over 5 MB client-side and fires no request', async () => {
    let requests = 0;
    server.use(
      http.post('/api/v1/students/bulk-upload', () => {
        requests += 1;
        return HttpResponse.json({}, { status: 500 });
      }),
    );
    renderImportPage();
    // A 5 MB + 1 byte payload without allocating a giant string per char.
    const big = 'x'.repeat(5 * 1024 * 1024 + 1);
    await uploadFile(makeFile('students.csv', big));

    const error = await screen.findByRole('alert');
    expect(error.textContent).toContain('larger than 5 MB');
    expect(requests).toBe(0);
  });

  it('states partial success unambiguously and lists per-row errors with the offending Bangla value', async () => {
    server.use(
      http.post('/api/v1/students/bulk-upload', () =>
        HttpResponse.json(
          {
            total_rows: 150,
            success_count: 142,
            error_count: 8,
            created_student_ids: [],
            errors: [
              {
                row: 2,
                field: 'guardian1_phone',
                value: '০১৭১২৩৪৫৬৭',
                reason: 'Invalid phone format: guardian1_phone',
              },
              { row: 5, reason: 'Missing required field: student_name; Invalid email format' },
            ],
          },
          { status: 201 },
        ),
      ),
    );
    renderImportPage();
    await uploadFile(makeFile('students.csv'));

    // The exact three-count sentence — neither success nor failure styling.
    const summary = await screen.findByText('142 of 150 students imported. 8 rows had problems.');
    expect(summary.className).not.toMatch(/destructive|success|green|red/);

    const table = await screen.findByRole('table', { name: 'Rows that could not be imported' });
    expect(within(table).getByText('০১৭১২৩৪৫৬৭')).toBeTruthy();
    expect(within(table).getByText('guardian1_phone')).toBeTruthy();
    expect(within(table).getByText('Invalid phone format: guardian1_phone')).toBeTruthy();
    // A whole-row problem has no single field/value.
    expect(within(table).getByText('Whole row')).toBeTruthy();
  });

  it('exports the error table as CSV with BOM and injection guard intact', async () => {
    server.use(
      http.post('/api/v1/students/bulk-upload', () =>
        HttpResponse.json(
          {
            total_rows: 2,
            success_count: 1,
            error_count: 1,
            created_student_ids: ['s-1'],
            errors: [
              { row: 2, field: 'student_name', value: '=cmd|/c calc', reason: 'Bad "name"' },
            ],
          },
          { status: 201 },
        ),
      ),
    );
    const downloads = captureDownloads();
    renderImportPage();
    await uploadFile(makeFile('students.csv'));

    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Export errors as CSV' }));
    await waitFor(() => expect(downloads.blob()).toBeDefined());
    const bytes = new Uint8Array(await downloads.blob()!.arrayBuffer());
    expect([bytes[0], bytes[1], bytes[2]]).toEqual([0xef, 0xbb, 0xbf]);
    const csv = new TextDecoder().decode(bytes);
    expect(csv).toContain(`"'=cmd|/c calc"`); // formula guard
    expect(csv).toContain('"Bad ""name"""'); // quote doubling
  });

  it('renders the success variant with no error table when every row imported', async () => {
    server.use(
      http.post('/api/v1/students/bulk-upload', () =>
        HttpResponse.json(
          {
            total_rows: 3,
            success_count: 3,
            error_count: 0,
            created_student_ids: ['a', 'b', 'c'],
            errors: [],
          },
          { status: 201 },
        ),
      ),
    );
    renderImportPage();
    await uploadFile(makeFile('students.csv'));

    await screen.findByText('All 3 students were imported.');
    expect(screen.queryByRole('table', { name: 'Rows that could not be imported' })).toBeNull();
  });

  it('renders a whole-request 400 as nothing-imported with the server message and a hint', async () => {
    server.use(
      http.post('/api/v1/students/bulk-upload', () =>
        HttpResponse.json(
          apiErrorBody(
            400,
            'Missing required columns: roll, section',
            '/api/v1/students/bulk-upload',
          ),
          { status: 400 },
        ),
      ),
    );
    renderImportPage();
    await uploadFile(makeFile('students.csv'));

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('Nothing was imported');
    expect(alert.textContent).toContain('Missing required columns: roll, section');
    expect(alert.textContent).toContain('Compare your file against the template');
  });

  it('announces the file selection politely (aria-live)', async () => {
    server.use(
      http.post('/api/v1/students/bulk-upload', () =>
        HttpResponse.json(
          {
            total_rows: 1,
            success_count: 1,
            error_count: 0,
            created_student_ids: ['s'],
            errors: [],
          },
          { status: 201 },
        ),
      ),
    );
    const { container } = renderImportPage();
    await uploadFile(makeFile('students.csv'));

    const liveRegions = Array.from(container.querySelectorAll('[aria-live="polite"]'));
    expect(liveRegions.some((node) => node.textContent?.includes('1 file selected'))).toBe(true);
  });

  it('shows the forbidden copy to a role without the bulk-upload permission (TEACHER)', async () => {
    renderImportPage('TEACHER');
    await screen.findByText("You don't have permission to view this.");
    await screen.findByRole('button', { name: 'Back to students' });
  });

  it('is axe clean with the error report shown', async () => {
    server.use(
      http.post('/api/v1/students/bulk-upload', () =>
        HttpResponse.json(
          {
            total_rows: 2,
            success_count: 1,
            error_count: 1,
            created_student_ids: ['s-1'],
            errors: [{ row: 2, field: 'roll', value: '5', reason: 'Duplicate roll number 5' }],
          },
          { status: 201 },
        ),
      ),
    );
    const { container } = renderImportPage();
    await uploadFile(makeFile('students.csv'));
    await screen.findByText('1 of 2 students imported. 1 rows had problems.');
    await expect(container).toHaveNoViolations();
  });
});

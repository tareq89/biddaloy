import { File as NodeFile } from 'node:buffer';

import { cleanupTestState, renderWithRouter, server } from '@biddaloy/ui/test';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { afterEach, describe, expect, it } from 'vitest';

import { routeTree } from '../../../routeTree.gen';

/**
 * [17.5.3] `/calendar/import` — mirrors `students/import.test.tsx`'s
 * validate-then-confirm coverage shape: nothing writes until "Commit
 * import" fires, and the preview table (not the upload response alone)
 * is what the commit button's enabled state depends on.
 */
function makeFile(name: string, content = 'a,b', type = 'text/csv'): File {
  return new NodeFile([content], name, { type }) as File;
}

function renderImportPage(role = 'ADMIN') {
  return renderWithRouter(routeTree, {
    initialEntries: ['/calendar/import'],
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
  return http.post('/api/v1/calendar-import/validate', () => HttpResponse.json(body, { status }));
}

const cleanPreview = {
  staging_id: 'stage-clean',
  expires_at: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
  summary: { new: 2, updated: 0, unchanged: 0, error: 0 },
  rows: [
    { row: 2, status: 'NEW', errors: [] },
    { row: 3, status: 'NEW', errors: [] },
  ],
};

const mixedPreview = {
  staging_id: 'stage-mixed',
  expires_at: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
  summary: { new: 1, updated: 1, unchanged: 1, error: 1 },
  rows: [
    { row: 2, status: 'NEW', errors: [] },
    { row: 3, status: 'UPDATED', errors: [] },
    { row: 4, status: 'UNCHANGED', errors: [] },
    { row: 5, status: 'ERROR', errors: [{ row: 5, column: null, message: 'Bad date', severity: 'error' }] },
  ],
};

describe('/calendar/import', () => {
  afterEach(async () => {
    await cleanupTestState();
  });

  it('renders a status pill for every row: NEW/UPDATED/UNCHANGED/ERROR', async () => {
    server.use(validateHandler(mixedPreview));
    renderImportPage();
    await uploadFile(makeFile('calendar.csv'));

    expect(await screen.findByText('New')).toBeTruthy();
    expect(screen.getByText('Updated')).toBeTruthy();
    expect(screen.getByText('Unchanged')).toBeTruthy();
    expect(screen.getByText('Error')).toBeTruthy();
    expect(screen.getByText('Bad date')).toBeTruthy();
  });

  it('re-uploading a file with only UNCHANGED rows shows them as unchanged, not errors', async () => {
    server.use(
      validateHandler({
        staging_id: 'stage-unchanged',
        expires_at: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
        summary: { new: 0, updated: 0, unchanged: 2, error: 0 },
        rows: [
          { row: 2, status: 'UNCHANGED', errors: [] },
          { row: 3, status: 'UNCHANGED', errors: [] },
        ],
      }),
    );
    renderImportPage();
    await uploadFile(makeFile('calendar.csv'));

    expect(await screen.findAllByText('Unchanged')).toHaveLength(2);
    // Commit stays enabled — an all-UNCHANGED file has no errors.
    const commitButton = screen.getByRole('button', { name: 'Commit import' });
    expect(commitButton.hasAttribute('disabled')).toBe(false);
  });

  it('disables Commit while ERROR rows exist and "Allow partial" is off', async () => {
    server.use(validateHandler(mixedPreview));
    renderImportPage();
    await uploadFile(makeFile('calendar.csv'));

    await screen.findByText('Error');
    const commitButton = screen.getByRole('button', { name: 'Commit import' });
    expect(commitButton.hasAttribute('disabled')).toBe(true);

    const user = userEvent.setup();
    await user.click(screen.getByLabelText('Import the valid rows anyway'));
    await waitFor(() => expect(commitButton.hasAttribute('disabled')).toBe(false));
  });

  it('does not commit until "Commit import" is clicked, then shows a draft success screen', async () => {
    let commitCalled = false;
    server.use(
      validateHandler(cleanPreview),
      http.post('/api/v1/calendar-import/commit', async ({ request }) => {
        commitCalled = true;
        const body = (await request.json()) as { publish?: boolean };
        expect(body.publish).toBe(false);
        return HttpResponse.json(
          { created: 2, updated: 0, unchanged: 0, failed: [] },
          { status: 201 },
        );
      }),
    );
    renderImportPage();
    await uploadFile(makeFile('calendar.csv'));

    await screen.findByText('2 new');
    expect(commitCalled).toBe(false);

    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Commit import' }));

    await screen.findByText('Import complete');
    expect(commitCalled).toBe(true);
    expect(screen.getByText('2 event(s) were saved as drafts.')).toBeTruthy();
  });

  it('shows a published success message when "Publish immediately" is checked', async () => {
    server.use(
      validateHandler(cleanPreview),
      http.post('/api/v1/calendar-import/commit', async ({ request }) => {
        const body = (await request.json()) as { publish?: boolean };
        expect(body.publish).toBe(true);
        return HttpResponse.json(
          { created: 2, updated: 0, unchanged: 0, failed: [] },
          { status: 201 },
        );
      }),
    );
    renderImportPage();
    await uploadFile(makeFile('calendar.csv'));
    await screen.findByText('2 new');

    const user = userEvent.setup();
    await user.click(screen.getByLabelText('Publish immediately'));
    await user.click(screen.getByRole('button', { name: 'Commit import' }));

    await screen.findByText('Import complete');
    expect(screen.getByText('2 event(s) were published.')).toBeTruthy();
  });

  it('shows the forbidden copy to a role without CALENDAR_MANAGE (TEACHER)', async () => {
    renderImportPage('TEACHER');
    await screen.findByText("You don't have access to this page.");
  });
});

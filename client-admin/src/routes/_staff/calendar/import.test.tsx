import { File as NodeFile } from 'node:buffer';

import type { CalendarImportValidateResponse } from '@biddaloy/ui/hooks';
import { cleanupTestState, renderWithRouter, server } from '@biddaloy/ui/test';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { afterEach, describe, expect, it } from 'vitest';

import { routeTree } from '../../../routeTree.gen';

import { setPendingClonePreview } from './import';

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

/** Picks a file only — the upload starts when "Check file" is pressed. */
async function pickFile(file: File) {
  const user = userEvent.setup({ applyAccept: false });
  await user.click(await screen.findByRole('button', { name: 'Choose file' }));
  const input = screen.getByLabelText('Choose file');
  await user.upload(input, file);
}

async function uploadFile(file: File) {
  await pickFile(file);
  await userEvent.setup().click(screen.getByRole('button', { name: 'Check file' }));
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
    {
      row: 5,
      status: 'ERROR',
      errors: [{ row: 5, column: 'start_date', message: 'Bad date', severity: 'error' }],
    },
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
  });

  it('shows a translated problem for a row error, never the server message', async () => {
    server.use(validateHandler(mixedPreview));
    renderImportPage();
    await uploadFile(makeFile('calendar.csv'));

    await screen.findByText('Error');
    expect(
      screen.getByText(
        'Column: Start date — this cell is not valid. Fix it in the file and upload again.',
      ),
    ).toBeTruthy();
    expect(screen.queryByText('Bad date')).toBeNull();
  });

  it('lists error rows first', async () => {
    server.use(validateHandler(mixedPreview));
    renderImportPage();
    await uploadFile(makeFile('calendar.csv'));

    await screen.findByText('Error');
    // The region (not the locale) picks the digits, so accept either script.
    const toLatin = (text: string) =>
      text.replace(/[০-৯]/g, (d) => String('০১২৩৪৫৬৭৮৯'.indexOf(d)));
    const labels = screen.getAllByText(/^Row [\d০-৯]+$/).map((el) => toLatin(el.textContent ?? ''));
    expect(labels).toEqual(['Row 5', 'Row 2', 'Row 3', 'Row 4']);
  });

  it('is a full-page frame with a Close button and a step label', async () => {
    renderImportPage();

    expect(await screen.findByRole('button', { name: 'Close' })).toBeTruthy();
    expect(screen.getByText('Step 1 of 2')).toBeTruthy();
  });

  it('does not upload when a file is picked, only when "Check file" is pressed', async () => {
    let validateCalls = 0;
    server.use(
      http.post('/api/v1/calendar-import/validate', () => {
        validateCalls += 1;
        return HttpResponse.json(cleanPreview, { status: 201 });
      }),
    );
    renderImportPage();

    const check = await screen.findByRole('button', { name: 'Check file' });
    expect(check.hasAttribute('disabled')).toBe(true);

    await pickFile(makeFile('calendar.csv'));
    expect(validateCalls).toBe(0);
    expect(check.hasAttribute('disabled')).toBe(false);

    await userEvent.setup().click(check);
    await screen.findByText('Step 2 of 2');
    expect(validateCalls).toBe(1);
    expect(screen.getByText('File: calendar.csv')).toBeTruthy();
  });

  it('shows a translated failure, not the thrown message, when the check fails', async () => {
    server.use(
      http.post('/api/v1/calendar-import/validate', () =>
        HttpResponse.json({ message: 'Server exploded' }, { status: 500 }),
      ),
    );
    renderImportPage();
    await uploadFile(makeFile('calendar.csv'));

    expect(await screen.findByText('Upload failed')).toBeTruthy();
    expect(screen.queryByText('Server exploded')).toBeNull();
  });

  it('asks before leaving when Close is pressed on the review step', async () => {
    server.use(validateHandler(cleanPreview));
    renderImportPage();
    await uploadFile(makeFile('calendar.csv'));
    await screen.findByText('Step 2 of 2');

    await userEvent.setup().click(screen.getByRole('button', { name: 'Close' }));

    expect(await screen.findByText('Discard your changes?')).toBeTruthy();
  });

  it('opens a clone preview straight on the review step, without a file line', async () => {
    setPendingClonePreview(cleanPreview as unknown as CalendarImportValidateResponse);
    renderImportPage();

    expect(await screen.findByText('Step 2 of 2')).toBeTruthy();
    expect(screen.queryByText(/^File:/)).toBeNull();
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
    const commitButton = screen.getByRole('button', { name: 'Confirm import' });
    expect(commitButton.hasAttribute('disabled')).toBe(false);
  });

  it('disables Commit while ERROR rows exist and "Allow partial" is off', async () => {
    server.use(validateHandler(mixedPreview));
    renderImportPage();
    await uploadFile(makeFile('calendar.csv'));

    await screen.findByText('Error');
    const commitButton = screen.getByRole('button', { name: 'Confirm import' });
    expect(commitButton.hasAttribute('disabled')).toBe(true);

    const user = userEvent.setup();
    await user.click(screen.getByLabelText('Import the valid rows anyway'));
    await waitFor(() => expect(commitButton.hasAttribute('disabled')).toBe(false));
  });

  it('does not commit until "Confirm import" is clicked, then shows a draft success screen', async () => {
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
    await user.click(screen.getByRole('button', { name: 'Confirm import' }));

    await screen.findByText('Import complete');
    expect(commitCalled).toBe(true);
    expect(screen.getByText('2 event(s) were saved as drafts.')).toBeTruthy();
  });

  it('shows an error and stays on the preview screen when commit fails', async () => {
    server.use(
      validateHandler(cleanPreview),
      http.post('/api/v1/calendar-import/commit', () =>
        HttpResponse.json({ message: 'Could not commit' }, { status: 500 }),
      ),
    );
    renderImportPage();
    await uploadFile(makeFile('calendar.csv'));
    await screen.findByText('2 new');

    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Confirm import' }));

    expect(await screen.findByRole('alert')).toBeTruthy();
    // Stayed on the preview screen, not a success screen — the button is
    // clickable again (not stuck disabled from a lingering isPending).
    expect(screen.getByRole('button', { name: 'Confirm import' }).hasAttribute('disabled')).toBe(
      false,
    );
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
    await user.click(screen.getByRole('button', { name: 'Confirm import' }));

    await screen.findByText('Import complete');
    expect(screen.getByText('2 event(s) were published.')).toBeTruthy();
  });

  it('shows the forbidden copy to a role without CALENDAR_MANAGE (TEACHER)', async () => {
    renderImportPage('TEACHER');
    await screen.findByText("You don't have access to this page.");
  });
});

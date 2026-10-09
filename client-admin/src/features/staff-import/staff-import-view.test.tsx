/** [13.5.1] Staff import view: problems, preview, commit with/without invitations, done, from=welcome. */
import '@biddaloy/ui/test';

import { cleanupTestState, renderWithRouter, server } from '@biddaloy/ui/test';
import { createRootRoute, createRoute } from '@tanstack/react-router';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { afterEach, describe, expect, it } from 'vitest';

import { rowErrorKey, StaffImportView } from './staff-import-view';

const preview = {
  staging_id: '11111111-1111-4111-8111-111111111111',
  expires_at: new Date(Date.now() + 10 * 60_000).toISOString(),
  summary: { create: 2, restore: 1, skip: 1 },
  rows: [
    {
      action: 'create',
      row: 2,
      name: 'Rahim Uddin',
      mobile: '01712345678',
      role: 'TEACHER',
      notes: [],
    },
    {
      action: 'create',
      row: 3,
      name: 'Karim',
      email: 'k@example.com',
      role: 'ACCOUNTANT',
      notes: [],
    },
    { action: 'restore', row: 4, name: 'Salma', mobile: '01811111111', role: 'TEACHER', notes: [] },
    { action: 'skip', row: 5, name: 'Jamal', mobile: '01911111111', role: 'ADMIN', notes: [] },
  ],
  errors: [],
  hard_error_count: 0,
};

function renderView(entry = '/staff/import') {
  const root = createRootRoute();
  const view = createRoute({
    getParentRoute: () => root,
    path: '/staff/import',
    component: StaffImportView,
  });
  return renderWithRouter(root.addChildren([view]), {
    initialEntries: [entry],
    locale: 'en',
    role: 'ADMIN',
    tenantId: 'school-1',
    accessToken: 'a.b.c',
  });
}

async function upload() {
  const user = userEvent.setup();
  const input = await screen.findByLabelText('Choose file');
  await user.upload(input, new File(['x'], 'staff.csv', { type: 'text/csv' }));
  return user;
}

afterEach(cleanupTestState);

describe('StaffImportView', () => {
  it('shows the column guide and nothing from the server before upload', async () => {
    renderView();
    expect(await screen.findByText('Each person needs a mobile number or an email.')).toBeTruthy();
    expect(screen.queryByRole('link', { name: 'Back to setup' })).toBeNull();
  });

  it('shows row problems in our own words and blocks confirm', async () => {
    server.use(
      http.post('/api/v1/users/bulk-upload/validate', () =>
        HttpResponse.json({
          ...preview,
          rows: [],
          errors: [
            {
              row: 2,
              column: 'mobile',
              message: 'Mobile was typed as a number, so a leading 0 may be lost.',
              severity: 'error',
              value: '1712345678',
            },
          ],
          hard_error_count: 1,
        }),
      ),
    );
    renderView();
    await upload();
    expect(await screen.findByText(/lost its leading 0/)).toBeTruthy();
    expect(screen.queryByText(/typed as a number/)).toBeNull();
    expect(screen.getByRole('button', { name: 'Confirm' }).hasAttribute('disabled')).toBe(true);
  });

  it.each([
    [true, 'invites'],
    [false, 'no invites'],
  ])('commits with send_invitations=%s and shows the done state', async (send) => {
    let body: unknown;
    server.use(
      http.post('/api/v1/users/bulk-upload/validate', () => HttpResponse.json(preview)),
      http.post('/api/v1/users/bulk-upload/commit', async ({ request }) => {
        body = await request.json();
        return HttpResponse.json({
          created: 2,
          restored: 1,
          skipped: 1,
          invited: send ? 2 : 0,
          failed: [{ row: 9, reason: 'x' }],
          invite_failed: [{ row: 3, reason: 'x' }],
        });
      }),
    );
    renderView();
    const user = await upload();
    expect(await screen.findByText('2 will be added')).toBeTruthy();
    expect(screen.getByText('1 will be brought back')).toBeTruthy();
    expect(screen.getByText('1 will be skipped')).toBeTruthy();
    const box = screen.getByRole('checkbox', { name: 'Send invitations now' });
    expect(box.getAttribute('aria-checked')).toBe('true');
    if (!send) await user.click(box);
    await user.click(screen.getByRole('button', { name: 'Confirm' }));
    expect(await screen.findByText('Import finished')).toBeTruthy();
    expect(body).toEqual({ staging_id: preview.staging_id, send_invitations: send });
    expect(screen.getByText('2 added')).toBeTruthy();
    expect(screen.getByText(/Could not add, rows: 9/)).toBeTruthy();
    expect(screen.getByText(/Invitation not sent, rows: 3/)).toBeTruthy();
    expect(screen.getByRole('link', { name: 'See staff' }).getAttribute('href')).toBe('/staff');
  });

  it('writes nothing before confirm', async () => {
    let commits = 0;
    server.use(
      http.post('/api/v1/users/bulk-upload/validate', () => HttpResponse.json(preview)),
      http.post('/api/v1/users/bulk-upload/commit', () => {
        commits += 1;
        return HttpResponse.json({});
      }),
    );
    renderView();
    await upload();
    await screen.findByText('2 will be added');
    expect(commits).toBe(0);
  });

  it('offers "Back to setup" only with from=welcome', async () => {
    renderView('/staff/import?from=welcome');
    const link = await screen.findByRole('link', { name: 'Back to setup' });
    expect(link.getAttribute('href')).toBe('/welcome?step=people');
  });
});

describe('rowErrorKey', () => {
  it('maps server text to translation keys, falling back by column', () => {
    expect(rowErrorKey({ column: null, message: 'Give a mobile number or an email' })).toBe(
      'missingContact',
    );
    expect(rowErrorKey({ column: 'mobile', message: 'phone must be valid' })).toBe('badPhone');
    expect(rowErrorKey({ column: 'email', message: 'email must be an email' })).toBe('badEmail');
    expect(rowErrorKey({ column: 'name', message: 'too long' })).toBe('other');
  });
});

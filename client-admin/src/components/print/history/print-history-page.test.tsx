import '@biddaloy/ui/test';

import type { PrintHistoryRow } from '@biddaloy/ui/hooks';
import { cleanupTestState, renderWithProviders, server } from '@biddaloy/ui/test';
import { screen, waitFor, within } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { PrintHistoryPage } from './print-history-page';

const row = (over: Partial<PrintHistoryRow> = {}): PrintHistoryRow => ({
  item_id: 'i-1',
  job_id: 'job-1',
  created_at: '2027-03-01T10:00:00.000Z',
  printed_by_name: 'Nadia Front Desk',
  template_name: 'Classic',
  template_version: 2,
  document_kind: 'STUDENT_ID_CARD',
  subject_type: 'STUDENT',
  subject_id: 's-1',
  subject_label: 'Rahim Ahmed',
  copy_number: 1,
  outcome: 'OK',
  revoked_at: null,
  job_status: 'CONFIRMED',
  ...over,
});

const page = (rows: PrintHistoryRow[]) => ({
  data: rows,
  total: rows.length,
  page: 1,
  limit: 10,
  totalPages: 1,
});

function serve(rows: PrintHistoryRow[]) {
  server.use(
    http.get('/api/v1/print-history', () => HttpResponse.json(page(rows))),
    http.get('/api/v1/print-templates', () => HttpResponse.json([])),
    http.get('/api/v1/users', () =>
      HttpResponse.json({ data: [], total: 0, page: 1, limit: 100, totalPages: 0 }),
    ),
  );
}

const render = (role = 'ADMIN', search = {}) => {
  const onSearchChange = vi.fn();
  const view = renderWithProviders(
    <PrintHistoryPage search={search} onSearchChange={onSearchChange} />,
    {
      locale: 'en',
      role,
      tenantId: 'school-1',
    },
  );
  return { ...view, onSearchChange };
};

describe('PrintHistoryPage', () => {
  afterEach(async () => {
    await cleanupTestState();
  });

  it('lists what was printed, with the document, person, copy and status', async () => {
    serve([row()]);
    render();

    expect(await screen.findAllByText('Rahim Ahmed')).toBeTruthy();
    expect(screen.getAllByText('Classic v2').length).toBeGreaterThan(0);
    expect(screen.getAllByText('#1').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Nadia Front Desk').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Valid').length).toBeGreaterThan(0);
  });

  it('shows the empty state when nothing has been printed', async () => {
    serve([]);
    render();
    expect(await screen.findByText(/Nothing printed yet/)).toBeTruthy();
  });

  it('sends a typed search to onSearchChange and goes back to page 1', async () => {
    serve([row()]);
    const { user, onSearchChange } = render();
    await screen.findAllByText('Rahim Ahmed');

    await user.type(screen.getByLabelText('Search by name'), 'rah');

    // The filter bar debounces typing, so wait for the settled value.
    await waitFor(() =>
      expect(onSearchChange).toHaveBeenCalledWith(
        expect.objectContaining({ q: 'rah', page: null }),
      ),
    );
  });

  it('hides Revoke from a role without DOCUMENT_REVOKE, but still lets an accountant Reprint', async () => {
    serve([row()]);
    render('ACCOUNTANT');

    await screen.findAllByText('Rahim Ahmed');
    expect(screen.getAllByRole('button', { name: /^Reprint/ }).length).toBeGreaterThan(0);
    expect(screen.queryAllByRole('button', { name: /^Revoke/ })).toHaveLength(0);
  });

  it('offers only View to a role that can read history but not print or revoke', async () => {
    serve([row()]);
    render('EXECUTIVE');

    await screen.findAllByText('Rahim Ahmed');
    expect(screen.getAllByRole('button', { name: /^View/ }).length).toBeGreaterThan(0);
    expect(screen.queryAllByRole('button', { name: /^Reprint/ })).toHaveLength(0);
    expect(screen.queryAllByRole('button', { name: /^Revoke/ })).toHaveLength(0);
  });

  it('needs a reason to revoke, sends it, and then shows the card as Revoked', async () => {
    let revoked = false;
    let body: Record<string, unknown> | undefined;
    server.use(
      http.get('/api/v1/print-history', () =>
        HttpResponse.json(page([row(revoked ? { revoked_at: '2027-03-02T00:00:00.000Z' } : {})])),
      ),
      http.get('/api/v1/print-templates', () => HttpResponse.json([])),
      http.get('/api/v1/users', () =>
        HttpResponse.json({ data: [], total: 0, page: 1, limit: 100, totalPages: 0 }),
      ),
      http.post('/api/v1/print-history/items/i-1/revoke', async ({ request }) => {
        body = (await request.json()) as Record<string, unknown>;
        revoked = true;
        return HttpResponse.json({ item_id: 'i-1', revoked_at: '2027-03-02T00:00:00.000Z' });
      }),
    );
    const { user } = render();
    await screen.findAllByText('Rahim Ahmed');
    expect(screen.getAllByText('Valid').length).toBeGreaterThan(0);

    await user.click(screen.getAllByRole('button', { name: /^Revoke/ })[0]!);
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText(/no longer valid/)).toBeTruthy(); // says what will happen

    // Without a reason nothing is sent.
    await user.click(within(dialog).getByRole('button', { name: 'Revoke card' }));
    expect(await within(dialog).findByText('Enter a reason.')).toBeTruthy();
    expect(body).toBeUndefined();

    await user.type(within(dialog).getByLabelText('Reason'), 'Lost card');
    await user.click(within(dialog).getByRole('button', { name: 'Revoke card' }));

    await waitFor(() => expect(body).toEqual({ reason: 'Lost card' }));
    expect((await screen.findAllByText('Revoked')).length).toBeGreaterThan(0);
    // A revoked card can't be revoked or reprinted again.
    expect(screen.queryAllByRole('button', { name: /^Revoke/ })).toHaveLength(0);
    expect(screen.queryAllByRole('button', { name: /^Reprint/ })).toHaveLength(0);
  });

  it('View shows the stored snapshot, rendered with the stored template', async () => {
    serve([row()]);
    server.use(
      http.get('/api/v1/print-history/items/i-1', () =>
        HttpResponse.json({
          ...row(),
          data_snapshot: {
            values: { 'student.name': 'Name As Printed', 'print.verify_qr': '' },
            photoKey: null,
            copyNumber: 1,
            issuedAt: '2027-03-01T10:00:00.000Z',
          },
          revoke_reason: null,
          template_definition: {
            page: { widthMm: 85.6, heightMm: 54, sides: ['front'] },
            front: {
              elements: [
                {
                  id: 'n',
                  type: 'TEXT',
                  x: 2,
                  y: 2,
                  w: 60,
                  h: 8,
                  fontFamily: 'Biddaloy Sans',
                  sizePt: 10,
                  weight: 400,
                  color: '#000000',
                  align: 'left',
                  overflow: 'CLIP',
                  field: 'student.name',
                },
              ],
            },
          },
        }),
      ),
    );
    const { user } = render();
    await screen.findAllByText('Rahim Ahmed');

    await user.click(screen.getAllByRole('button', { name: /^View/ })[0]!);

    expect(await screen.findByText('Name As Printed')).toBeTruthy();
    expect(screen.getByText(/QR code is not stored/)).toBeTruthy();
  });
});

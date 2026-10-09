import '@biddaloy/ui/test';

import type { RegisterRow } from '@biddaloy/ui/hooks';
import { REGION_BD_BN, REGION_BD_EN, RegionConfigProvider } from '@biddaloy/ui/i18n';
import { cleanupTestState, renderWithProviders, server } from '@biddaloy/ui/test';
import { screen, waitFor, within } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { runPrint } from '../preview/run-print';

import { CertificateRegister } from './certificate-register';
import type { PrintHistorySearch } from './print-history-filters';

vi.mock('../preview/run-print', () => ({ runPrint: vi.fn() }));

const TABS = 'tabs';

const row = (over: Partial<RegisterRow> = {}): RegisterRow => ({
  item_id: 'i-1',
  document_kind: 'TESTIMONIAL',
  serial: 'TSM-2026-00009',
  serial_year: 2026,
  serial_no: 9,
  copy_number: 1,
  subject_id: 's-1',
  subject_label: 'Rafi Hasan',
  class_name: 'Ten',
  issued_at: '2026-10-08T05:00:00.000Z',
  printed_by_name: 'Sabina',
  revoked_at: null,
  revoke_reason: null,
  ...over,
});

let query: URLSearchParams | undefined;
function serve(rows: RegisterRow[]) {
  query = undefined;
  server.use(
    http.get('/api/v1/print-history/register', ({ request }) => {
      query = new URL(request.url).searchParams;
      return HttpResponse.json({
        data: rows,
        total: rows.length,
        page: 1,
        limit: 25,
        totalPages: 1,
      });
    }),
  );
}

const render = (role = 'ADMIN', search: PrintHistorySearch = {}, locale: 'en' | 'bn' = 'en') => {
  const onSearchChange = vi.fn();
  const view = renderWithProviders(
    <RegionConfigProvider value={locale === 'bn' ? REGION_BD_BN : REGION_BD_EN}>
      <CertificateRegister
        search={search}
        onSearchChange={onSearchChange}
        tabs={<nav aria-label={TABS}>{TABS}</nav>}
      />
    </RegionConfigProvider>,
    { locale, role, tenantId: 'school-1' },
  );
  return { ...view, onSearchChange };
};

describe('CertificateRegister', () => {
  afterEach(async () => {
    vi.mocked(runPrint).mockReset();
    await cleanupTestState();
  });

  it('lists serial, kind, student and a duplicate copy as "2 · duplicate"', async () => {
    serve([row(), row({ item_id: 'i-2', serial: 'TC-2026-00007', copy_number: 2 })]);
    render();
    expect((await screen.findAllByText('TSM-2026-00009')).length).toBeGreaterThan(0);
    expect(screen.getAllByText('Testimonial').length).toBeGreaterThan(0);
    expect(screen.getAllByText('2 · duplicate').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Valid').length).toBeGreaterThan(0);
  });

  it('a revoked row keeps its serial, shows the badge and the reason, and nothing is struck through', async () => {
    serve([
      row({
        item_id: 'i-3',
        serial: 'TC-2026-00006',
        revoked_at: '2026-10-09T00:00:00.000Z',
        revoke_reason: 'Wrong school name',
      }),
    ]);
    const { container } = render();
    expect((await screen.findAllByText('TC-2026-00006')).length).toBeGreaterThan(0);
    expect(screen.getAllByText('Revoked').length).toBeGreaterThan(0);
    expect(screen.getAllByText(/Wrong school name/).length).toBeGreaterThan(0);
    expect(container.querySelector('.line-through')).toBeNull();
    const dataRow = screen.getAllByRole('row').find((r) => within(r).queryByText('TC-2026-00006'))!;
    expect(within(dataRow).queryByRole('button', { name: 'Revoke' })).toBeNull();
  });

  it('sends the kind, year and status filters to the server', async () => {
    serve([row()]);
    render('ADMIN', { document_kind: 'TESTIMONIAL', year: 2026, status: 'VALID', page: 2 });
    await screen.findAllByText('Rafi Hasan');
    expect(query?.get('document_kind')).toBe('TESTIMONIAL');
    expect(query?.get('year')).toBe('2026');
    expect(query?.get('status')).toBe('VALID');
    expect(query?.get('page')).toBe('2');
  });

  it('a typed search goes to onSearchChange and back to page 1', async () => {
    serve([row()]);
    const { user, onSearchChange } = render('ADMIN', { page: 3 });
    await screen.findAllByText('Rafi Hasan');
    await user.type(screen.getByLabelText('Search by name'), 'rafi');
    await waitFor(() =>
      expect(onSearchChange).toHaveBeenCalledWith(
        expect.objectContaining({ q: 'rafi', page: null }),
      ),
    );
  });

  it('Export downloads the CSV with the same filters', async () => {
    serve([row()]);
    let csvQuery: URLSearchParams | undefined;
    server.use(
      http.get('/api/v1/print-history/register.csv', ({ request }) => {
        csvQuery = new URL(request.url).searchParams;
        return new HttpResponse('serial\nTSM-2026-00009', {
          headers: { 'Content-Type': 'text/csv' },
        });
      }),
    );
    URL.createObjectURL = vi.fn(() => 'blob:x');
    URL.revokeObjectURL = vi.fn();
    const { user } = render('ADMIN', { document_kind: 'TESTIMONIAL', year: 2026 });
    await screen.findAllByText('Rafi Hasan');
    await user.click(screen.getByRole('button', { name: 'Download for Excel' }));
    await waitFor(() => expect(csvQuery).toBeDefined());
    expect(csvQuery?.get('document_kind')).toBe('TESTIMONIAL');
    expect(csvQuery?.get('year')).toBe('2026');
  });

  it('an EXECUTIVE can reprint a testimonial but not a result certificate; reprint uses the certificate channel', async () => {
    serve([
      row(),
      row({ item_id: 'i-9', serial: 'RES-2026-00001', document_kind: 'RESULT_CERTIFICATE' }),
    ]);
    server.use(
      http.get('/api/v1/print-history/items/i-1', () =>
        HttpResponse.json({
          item_id: 'i-1',
          job_id: 'job-1',
          subject_label: 'Rafi Hasan',
          subject_type: 'STUDENT',
          document_kind: 'TESTIMONIAL',
        }),
      ),
      http.get('/api/v1/certificates/printers', () =>
        HttpResponse.json([
          {
            id: 'p-1',
            name: 'Office',
            printer_type: 'CARD',
            margin_top_mm: 0,
            margin_right_mm: 0,
            margin_bottom_mm: 0,
            margin_left_mm: 0,
            offset_x_mm: 0,
            offset_y_mm: 0,
            scale: 1,
            duplex_order: 'INTERLEAVED',
            sheet_gap_mm: 2,
            archived_at: null,
          },
        ]),
      ),
      http.get('/api/v1/certificates/assets', () => HttpResponse.json([])),
    );
    vi.mocked(runPrint).mockResolvedValue(undefined);
    const { user } = render('EXECUTIVE');
    await screen.findAllByText('Rafi Hasan');
    const rowOf = (serial: string) =>
      screen.getAllByRole('row').find((r) => within(r).queryByText(serial))!;
    expect(within(rowOf('RES-2026-00001')).queryByRole('button', { name: 'Reprint' })).toBeNull();
    await user.click(within(rowOf('TSM-2026-00009')).getByRole('button', { name: 'Reprint' }));
    const printButton = await screen.findByRole('button', { name: 'Print' });
    await waitFor(() => expect((printButton as HTMLButtonElement).disabled).toBe(false));
    await user.click(printButton);
    const args = vi.mocked(runPrint).mock.calls[0]![0];
    expect(args.request).toMatchObject({
      kind: 'reprint',
      jobId: 'job-1',
      itemIds: ['i-1'],
      documentKind: 'TESTIMONIAL',
    });
    expect(args.assetPath).toBe('/certificates/assets');
  });

  it('shows Bangla digits and the Bangla heading in bn', async () => {
    serve([row()]);
    render('ADMIN', { year: 2026 }, 'bn');
    expect((await screen.findAllByText('TSM-2026-00009')).length).toBeGreaterThan(0);
    expect(document.body.textContent).toContain('২০২৬');
    expect(screen.getAllByText('বৈধ').length).toBeGreaterThan(0);
  });

  it('is axe clean with the tabs slot', async () => {
    serve([row()]);
    const { container } = render();
    await screen.findAllByText('Rafi Hasan');
    await expect(container).toHaveNoViolations();
  });
});

import '@biddaloy/ui/test';

import type { PrinterRow, PrintHistoryRow } from '@biddaloy/ui/hooks';
import { REGION_BD_EN, RegionConfigProvider } from '@biddaloy/ui/i18n';
import { cleanupTestState, renderWithProviders, server } from '@biddaloy/ui/test';
import { screen } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { SubjectPrintHistory } from './subject-print-history';

const row: PrintHistoryRow = {
  item_id: 'i-1',
  job_id: 'job-1',
  created_at: '2027-03-01T10:00:00.000Z',
  printed_by_name: 'Nadia',
  template_name: 'Classic',
  template_version: 1,
  document_kind: 'STUDENT_ID_CARD',
  subject_type: 'STUDENT',
  subject_id: 's-1',
  subject_label: 'Rahim Ahmed',
  copy_number: 2,
  outcome: 'OK',
  revoked_at: null,
  job_status: 'CONFIRMED',
};

const printer = (over: Partial<PrinterRow>): PrinterRow => ({
  id: 'p-1',
  name: 'Front office',
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
  ...over,
});

const render = (role = 'ADMIN') =>
  renderWithProviders(
    <RegionConfigProvider value={REGION_BD_EN}>
      <SubjectPrintHistory subjectType="STUDENT" subjectId="s-1" />
    </RegionConfigProvider>,
    { locale: 'en', role, tenantId: 'school-1' },
  );

describe('SubjectPrintHistory', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });
  afterEach(async () => {
    await cleanupTestState();
  });

  it('says "Not printed yet" when there is nothing', async () => {
    server.use(http.get('/api/v1/print-jobs/subject-history', () => HttpResponse.json([])));
    render();
    expect(await screen.findByText('Not printed yet')).toBeTruthy();
  });

  it('shows a revoked print as Revoked', async () => {
    server.use(
      http.get('/api/v1/print-jobs/subject-history', () =>
        HttpResponse.json([{ ...row, revoked_at: '2027-03-02T00:00:00.000Z' }]),
      ),
    );
    render();
    expect(await screen.findByText('Revoked')).toBeTruthy();
    expect(screen.queryByText('Printed')).toBeNull();
  });

  it('lists each print with its copy and status, for that person only', async () => {
    let query: URLSearchParams | undefined;
    server.use(
      http.get('/api/v1/print-jobs/subject-history', ({ request }) => {
        query = new URL(request.url).searchParams;
        return HttpResponse.json([row]);
      }),
    );
    render();

    expect(await screen.findByText(/Classic · Version 1 · #2/)).toBeTruthy();
    expect(screen.getByText('Printed')).toBeTruthy();
    expect(query?.get('subject_type')).toBe('STUDENT');
    expect(query?.get('subject_id')).toBe('s-1');
  });

  it('opens the reprint dialog on the remembered printer', async () => {
    window.localStorage.setItem('print.printer.school-1', 'p-2');
    server.use(
      http.get('/api/v1/print-jobs/subject-history', () => HttpResponse.json([row])),
      http.get('/api/v1/printers', () =>
        HttpResponse.json([printer({}), printer({ id: 'p-2', name: 'Staff room' })]),
      ),
      http.get('/api/v1/print-assets', () => HttpResponse.json([])),
    );
    const { user } = render();

    await user.click(await screen.findByRole('button', { name: 'Reprint' }));

    expect(await screen.findByText('Reprint Rahim Ahmed')).toBeTruthy();
    expect(await screen.findByText('Staff room')).toBeTruthy(); // the remembered one is selected
  });

  it('does not offer Reprint to a role that cannot print', async () => {
    server.use(http.get('/api/v1/print-jobs/subject-history', () => HttpResponse.json([row])));
    render('EXECUTIVE');
    await screen.findByText(/Classic/);
    expect(screen.queryByRole('button', { name: 'Reprint' })).toBeNull();
  });
});

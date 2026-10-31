/**
 * [8.15.17] "Download everything that matches" on the four lists that have no test file of their
 * own for it: guardians, invoices, payments and the audit trail (students and dues are covered in
 * their own route tests). Real route tree, so each page's own filters reach the export request.
 * One shared table keeps the four lists saying and doing the same thing.
 */
import {
  auditEntryFactory,
  cleanupTestState,
  guardianFactory,
  invoiceFactory,
  renderWithRouter,
  server,
} from '@biddaloy/ui/test';
import { toLatinDigits } from '@biddaloy/ui/utils';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { afterEach, describe, expect, it } from 'vitest';

import { routeTree } from '../../routeTree.gen';
import { stubExportDownload } from '../../test/export-download';

interface ListCase {
  name: string;
  role: string;
  /** The list route with filters (and a page number the export must drop). */
  entry: string;
  listUrl: string;
  row: unknown;
  exportUrl: string;
  /** What the export request must carry: the active filters plus the format. */
  params: Record<string, string>;
  /** What one row is called in the button ("42 items", "321 people"). */
  unit: 'people' | 'items';
}

const CASES: ListCase[] = [
  {
    name: 'guardians',
    role: 'ADMIN',
    entry: '/guardians?relationship=Father&search=Karim&page=2',
    listUrl: '/api/v1/guardians',
    row: guardianFactory({ id: 'guardian-1' }),
    exportUrl: '/guardians/export',
    params: { relationship: 'Father', search: 'Karim' },
    unit: 'people',
  },
  {
    name: 'invoices',
    role: 'ACCOUNTANT',
    entry: '/invoices?status=OVERDUE&from_date=2026-01-01&page=2',
    listUrl: '/api/v1/invoices',
    row: invoiceFactory({ id: 'invoice-1' }),
    exportUrl: '/invoices/export',
    params: { status: 'OVERDUE', from_date: '2026-01-01' },
    unit: 'items',
  },
  {
    name: 'payments',
    role: 'ACCOUNTANT',
    entry: '/payments?payment_method=BKASH&date_from=2026-03-01&include_reversed=true&page=2',
    listUrl: '/api/v1/payments',
    row: {
      id: 'p1',
      student: { full_name: 'Rahim Uddin', registration_number: 'REG-001' },
      total_amount: 1500,
      payment_method: 'BKASH',
      transaction_reference: null,
      payment_date: '2026-03-05T06:00:00.000Z',
      reversal_of_payment_id: null,
      reversed_by_payment_id: null,
    },
    exportUrl: '/payments/export',
    params: { payment_method: 'BKASH', date_from: '2026-03-01', include_reversed: 'true' },
    unit: 'items',
  },
  {
    name: 'audit logs',
    role: 'ADMIN',
    entry: '/audit-logs?action=UPDATE&entity_type=Student&from_date=2026-01-01&page=2',
    listUrl: '/api/v1/audit-logs',
    row: auditEntryFactory(),
    exportUrl: '/audit-logs/export',
    params: { action: 'UPDATE', entity_type: 'Student', from_date: '2026-01-01' },
    unit: 'items',
  },
];

function serveList(listUrl: string, row: unknown, total: number) {
  server.use(
    http.get(listUrl, () =>
      HttpResponse.json({
        data: [row],
        total,
        page: 1,
        limit: 25,
        totalPages: Math.ceil(total / 25),
      }),
    ),
  );
}

function open(entry: string, role: string) {
  return renderWithRouter(routeTree, {
    initialEntries: [entry],
    tenantId: 'tenant-1',
    role,
    locale: 'en',
  });
}

describe.each(CASES)('$name list: download everything that matches [8.15.17]', (c) => {
  afterEach(async () => {
    await cleanupTestState();
  });

  it('one click downloads the filtered list as Excel, with exactly the active filters', async () => {
    serveList(c.listUrl, c.row, 321);
    const download = stubExportDownload();
    try {
      open(c.entry, c.role);
      const user = userEvent.setup();
      // Some of these pages show the default Bangla digits under the English words.
      const button = await screen.findByRole(
        'button',
        { name: new RegExp(`Download to Excel.*(321|৩২১).*${c.unit}`) },
        { timeout: 5000 },
      );
      await user.click(button);
      await waitFor(() => expect(download.sent).toHaveLength(1));
      expect(download.sent[0]).toEqual({
        url: c.exportUrl,
        params: { ...c.params, format: 'XLSX' },
      });
    } finally {
      download.restore();
    }
  });

  it('offers the CSV for other software, and no ticked-rows item (no row selection here)', async () => {
    serveList(c.listUrl, c.row, 2);
    const download = stubExportDownload();
    try {
      open(c.entry, c.role);
      const user = userEvent.setup();
      await user.click(await screen.findByRole('button', { name: 'More ways to download' }));
      expect(screen.queryByRole('menuitem', { name: /you ticked/ })).toBeNull();
      await user.click(await screen.findByRole('menuitem', { name: /CSV/ }));
      await waitFor(() => expect(download.sent).toHaveLength(1));
      expect(download.sent[0]?.params.format).toBe('CSV');
    } finally {
      download.restore();
    }
  });

  it('says what to do next, inline, when more than 5,000 rows match', async () => {
    serveList(c.listUrl, c.row, 9000);
    const download = stubExportDownload('too-large');
    try {
      open(c.entry, c.role);
      const user = userEvent.setup();
      await user.click(await screen.findByRole('button', { name: /Download to Excel/ }));
      expect(toLatinDigits((await screen.findByRole('alert')).textContent ?? '')).toBe(
        `Cannot download more than 5,000 ${c.unit} at once yet. Narrow the filters.`,
      );
    } finally {
      download.restore();
    }
  });
});

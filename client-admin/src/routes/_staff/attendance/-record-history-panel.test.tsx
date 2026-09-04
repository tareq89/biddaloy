import { cleanupTestState, renderWithProviders, server } from '@biddaloy/ui/test';
import { screen, within } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { afterEach, describe, expect, it } from 'vitest';

import { RecordHistoryPanel } from './-record-history-panel';

function historyEntry(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'audit-1',
    tenant_id: 'tenant-1',
    action: 'UPDATE',
    entity_type: 'AttendanceRecord',
    entity_id: 'record-1',
    performed_by_user_id: 'user-1',
    performed_by_name: null,
    old_values: { status: 'ABSENT' },
    new_values: { status: 'PRESENT', reason: 'Student was at inter-school meet.' },
    ip_address: null,
    user_agent: null,
    created_at: '2026-09-02T10:14:00.000Z',
    ...overrides,
  };
}

function renderPanel(recordId: string | undefined = 'record-1') {
  return renderWithProviders(<RecordHistoryPanel recordId={recordId} studentName="Rahim Uddin" />, {
    tenantId: 'tenant-1',
    locale: 'en',
  });
}

describe('RecordHistoryPanel', () => {
  afterEach(async () => {
    await cleanupTestState();
  });

  it('renders old → new and the reason for a populated history, newest first', async () => {
    server.use(
      http.get('/api/v1/attendance/records/record-1/history', () =>
        HttpResponse.json({
          data: [
            historyEntry({
              id: 'audit-2',
              created_at: '2026-09-04T10:14:00.000Z',
              new_values: { status: 'LATE', reason: 'Bus broke down' },
            }),
            historyEntry({ id: 'audit-1', created_at: '2026-09-02T10:14:00.000Z' }),
          ],
          total: 2,
          page: 1,
          limit: 10,
          totalPages: 1,
        }),
      ),
    );

    renderPanel();

    const rows = await screen.findAllByRole('listitem');
    expect(rows).toHaveLength(2);
    expect(within(rows[0]!).getByText('Absent → Late')).toBeTruthy();
    expect(within(rows[0]!).getByText(/Bus broke down/)).toBeTruthy();
    expect(within(rows[1]!).getByText('Absent → Present')).toBeTruthy();
    expect(within(rows[1]!).getByText(/inter-school meet/)).toBeTruthy();
  });

  it('renders the raw performed_by_user_id when no name was joined', async () => {
    server.use(
      http.get('/api/v1/attendance/records/record-1/history', () =>
        HttpResponse.json({
          data: [historyEntry()],
          total: 1,
          page: 1,
          limit: 10,
          totalPages: 1,
        }),
      ),
    );

    renderPanel();
    expect(await screen.findByText(/user-1/)).toBeTruthy();
  });

  it('renders an empty state when the record has never been corrected', async () => {
    server.use(
      http.get('/api/v1/attendance/records/record-1/history', () =>
        HttpResponse.json({ data: [], total: 0, page: 1, limit: 10, totalPages: 1 }),
      ),
    );

    renderPanel();
    expect(await screen.findByText('No changes')).toBeTruthy();
    expect(screen.getByText("This mark hasn't been edited.")).toBeTruthy();
  });

  it('renders an error state with retry on failure', async () => {
    server.use(
      http.get('/api/v1/attendance/records/record-1/history', () =>
        HttpResponse.json({ statusCode: 500 }, { status: 500 }),
      ),
    );

    renderPanel();
    expect(await screen.findByText('Could not load change history.')).toBeTruthy();
  });

  it('never fires a request when recordId is undefined', () => {
    renderPanel(undefined);
    expect(screen.queryByText('No changes')).toBeNull();
  });
});

/**
 * [16.7.5] Schedule detail's exclusions table — rendered directly, not
 * through a routed page, same precedent as `-schedule-form-dialog.test.tsx`
 * for a route-private component with no route of its own to mount through.
 *
 * Covers the add/remove exclusion flow that #679's Tests section promised
 * but this component never got its own suite for.
 */
import { REGION_BD_EN, RegionConfigProvider } from '@biddaloy/ui/i18n';
import { cleanupTestState, renderWithProviders, server, studentFactory } from '@biddaloy/ui/test';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import * as React from 'react';
import { afterEach, describe, expect, it } from 'vitest';

import { ExclusionsTable } from './-exclusions-table';

async function renderTable(props: Partial<React.ComponentProps<typeof ExclusionsTable>> = {}) {
  const view = renderWithProviders(
    <RegionConfigProvider value={REGION_BD_EN}>
      <ExclusionsTable scheduleId="schedule-1" exclusions={[]} canManage {...props} />
    </RegionConfigProvider>,
    { tenantId: 'tenant-1', role: 'ADMIN', locale: 'en' },
  );
  await view.localeReady;
  return view;
}

describe('fees/schedules/-exclusions-table', () => {
  afterEach(async () => {
    await cleanupTestState();
  });

  it('lists existing exclusions with their reason', async () => {
    await renderTable({
      exclusions: [
        {
          student_id: 'student-1',
          student_name: 'Rahim Uddin',
          reason: 'Sibling discount',
          created_at: '2026-01-01T00:00:00.000Z',
        },
      ],
    });

    expect(await screen.findByText('Rahim Uddin')).toBeTruthy();
    expect(screen.getByText('Sibling discount')).toBeTruthy();
    // When it was excluded, as a long date — never the ISO string.
    expect(screen.getByText('1st January, 2026')).toBeTruthy();
    expect(screen.queryByText(/2026-01-01/)).toBeNull();
  });

  it('searches students and adds one as an exclusion with a reason', async () => {
    const student = studentFactory({
      id: 'student-2',
      full_name: 'Karim Sheikh',
      registration_number: 'REG-2026-0002',
    });
    server.use(
      http.get('/api/v1/students', () =>
        HttpResponse.json({ data: [student], total: 1, page: 1, limit: 10, totalPages: 1 }),
      ),
    );
    let addedBody: Record<string, unknown> | undefined;
    server.use(
      http.post('/api/v1/fees/schedules/schedule-1/exclusions', async ({ request }) => {
        addedBody = (await request.json()) as Record<string, unknown>;
        return HttpResponse.json({
          student_id: student.id,
          student_name: student.full_name,
          reason: (addedBody?.reason as string | undefined) ?? null,
          created_at: '2026-01-01T00:00:00.000Z',
        });
      }),
    );

    const user = userEvent.setup();
    await renderTable();

    await user.type(screen.getByLabelText('Search students'), 'Karim');
    await screen.findByText('Karim Sheikh');
    expect(screen.getByText('REG-2026-0002')).toBeTruthy();

    // One reason field serves every result; "Exclude" stays disabled until it has text.
    const exclude = screen.getByRole<HTMLButtonElement>('button', { name: 'Exclude' });
    expect(exclude.disabled).toBe(true);
    await user.type(screen.getByLabelText('Reason * (required)'), 'Sibling discount');
    expect(exclude.disabled).toBe(false);
    await user.click(exclude);

    await waitFor(() =>
      expect(addedBody).toEqual({ student_id: 'student-2', reason: 'Sibling discount' }),
    );
    // Both fields are cleared after a successful add.
    await waitFor(() =>
      expect(screen.getByLabelText<HTMLInputElement>('Search students').value).toBe(''),
    );
    expect(screen.getByLabelText<HTMLInputElement>('Reason * (required)').value).toBe('');
  });

  it('shows a no-results message when the student search returns nothing', async () => {
    server.use(
      http.get('/api/v1/students', () =>
        HttpResponse.json({ data: [], total: 0, page: 1, limit: 10, totalPages: 1 }),
      ),
    );

    const user = userEvent.setup();
    await renderTable();

    await user.type(screen.getByLabelText('Search students'), 'Nobody');

    expect(await screen.findByText('No students found')).toBeTruthy();
  });

  it('removes an existing exclusion', async () => {
    let removedPath: string | undefined;
    server.use(
      http.delete('/api/v1/fees/schedules/schedule-1/exclusions/student-1', ({ request }) => {
        removedPath = new URL(request.url).pathname;
        return new HttpResponse(null, { status: 204 });
      }),
    );

    const user = userEvent.setup();
    await renderTable({
      exclusions: [
        {
          student_id: 'student-1',
          student_name: 'Rahim Uddin',
          reason: 'Sibling discount',
          created_at: '2026-01-01T00:00:00.000Z',
        },
      ],
    });

    await user.click(await screen.findByRole('button', { name: 'Include again' }));

    await waitFor(() =>
      expect(removedPath).toBe('/api/v1/fees/schedules/schedule-1/exclusions/student-1'),
    );
  });

  it('hides add/remove actions when canManage is false', async () => {
    await renderTable({
      canManage: false,
      exclusions: [
        {
          student_id: 'student-1',
          student_name: 'Rahim Uddin',
          reason: 'Sibling discount',
          created_at: '2026-01-01T00:00:00.000Z',
        },
      ],
    });

    await screen.findByText('Rahim Uddin');
    expect(screen.queryByRole('button', { name: 'Include again' })).toBeNull();
    expect(screen.queryByLabelText('Search students')).toBeNull();
    expect(screen.queryByLabelText('Reason * (required)')).toBeNull();
  });
});

import { cleanupTestState, renderWithProviders, server } from '@biddaloy/ui/test';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { FillAssistDialog } from './-fill-assist-dialog';

afterEach(async () => {
  await cleanupTestState();
});

const PROPOSAL = {
  section_id: 'section-1',
  period_slot_id: 'p1',
  weekday: 1,
  subject_id: 'subject-math',
  teacher_ids: ['teacher-1'],
  recurrence: 'WEEKLY' as const,
  recurrence_offset: 0,
  valid_from: '2026-01-01',
  valid_to: null,
};

function mockLookups() {
  server.use(
    http.get('/api/v1/routines/routine-1/greedy-fill', () => HttpResponse.json([PROPOSAL])),
    http.get('/api/v1/subjects', () =>
      HttpResponse.json({
        data: [{ id: 'subject-math', name_en: 'Math', name_bn: null, code: 'MATH', is_active: true }],
        total: 1,
        page: 1,
        limit: 100,
        totalPages: 1,
      }),
    ),
    http.get('/api/v1/teachers', () =>
      HttpResponse.json({
        data: [{ id: 'teacher-1', user: { full_name: 'Ms Nahar' } }],
        total: 1,
        page: 1,
        limit: 100,
        totalPages: 1,
      }),
    ),
  );
}

describe('FillAssistDialog', () => {
  it('previews the proposed slot and only writes it once confirmed', async () => {
    mockLookups();
    let created: unknown = null;
    server.use(
      http.post('/api/v1/routines/routine-1/slots', async ({ request }) => {
        created = await request.json();
        return HttpResponse.json({ slot: { id: 's1' }, teacher_ids: ['teacher-1'], warnings: [] });
      }),
    );
    const user = userEvent.setup();
    const onDone = vi.fn();
    renderWithProviders(
      <FillAssistDialog
        open
        onOpenChange={vi.fn()}
        routineId="routine-1"
        sectionId="section-1"
        weekdayLabels={{ 1: 'Mon' }}
        onDone={onDone}
      />,
      { tenantId: 'tenant-1', locale: 'en' },
    );

    await waitFor(() => expect(screen.getByText(/Math/)).toBeTruthy());
    expect(created).toBeNull(); // preview only, nothing written yet

    await user.click(screen.getByRole('button', { name: /Fill 1 period/i }));
    await waitFor(() => expect(created).not.toBeNull());
    expect((created as { subject_id: string }).subject_id).toBe('subject-math');
    expect(onDone).toHaveBeenCalled();
  });

  it('shows an empty state when there is nothing left to fill', async () => {
    server.use(
      http.get('/api/v1/routines/routine-1/greedy-fill', () => HttpResponse.json([])),
    );
    renderWithProviders(
      <FillAssistDialog
        open
        onOpenChange={vi.fn()}
        routineId="routine-1"
        sectionId="section-1"
        weekdayLabels={{}}
        onDone={vi.fn()}
      />,
      { tenantId: 'tenant-1', locale: 'en' },
    );

    await waitFor(() => expect(screen.getByText(/Nothing left to fill/i)).toBeTruthy());
    expect(screen.getByRole<HTMLButtonElement>('button', { name: /Fill 0 periods/i }).disabled).toBe(true);
  });
});

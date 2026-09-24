import { cleanupTestState, renderWithProviders, server } from '@biddaloy/ui/test';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { SubstitutionDialog } from './-substitution-dialog';

afterEach(async () => {
  await cleanupTestState();
});

function mockPickerData() {
  server.use(
    http.get('/api/v1/classes', () =>
      HttpResponse.json({
        data: [{ id: 'class-1', name: 'Class 6', section_count: 1, student_count: 40 }],
        total: 1,
        page: 1,
        limit: 100,
        totalPages: 1,
      }),
    ),
    http.get('/api/v1/classes/class-1/sections', () =>
      HttpResponse.json([
        {
          id: 'section-1',
          class_id: 'class-1',
          class: { id: 'class-1', name: 'Class 6', academic_year_id: 'year-1' },
          section_name: 'A',
          enrolled_count: 40,
        },
      ]),
    ),
    http.get('/api/v1/routines', () =>
      HttpResponse.json([
        {
          id: 'routine-1',
          academic_year_id: 'year-1',
          state: 'PUBLISHED',
          created_at: '2026-01-01T00:00:00Z',
        },
      ]),
    ),
    http.get('/api/v1/routines/routine-1/slots', () =>
      HttpResponse.json([
        {
          slot: {
            id: 'slot-1',
            section_id: 'section-1',
            weekday: 1,
            period_slot_id: 'p1',
            subject_id: 'subject-math',
            recurrence: 'WEEKLY',
            recurrence_offset: 0,
            valid_from: '2026-01-01',
            valid_to: null,
          },
          teacher_ids: ['teacher-1'],
          warnings: [],
        },
      ]),
    ),
    http.get('/api/v1/teachers', () =>
      HttpResponse.json({
        data: [{ id: 'teacher-1', user: { id: 'user-1', full_name: 'Ms Nahar' } }],
        total: 1,
        page: 1,
        limit: 100,
        totalPages: 1,
      }),
    ),
  );
}

describe('SubstitutionDialog', () => {
  it('records a cover for the selected slot and date', async () => {
    mockPickerData();
    let posted: unknown = null;
    server.use(
      http.post('/api/v1/routines/substitutions', async ({ request }) => {
        posted = await request.json();
        return HttpResponse.json({ id: 'sub-1' });
      }),
    );
    const onDone = vi.fn();
    const user = userEvent.setup();
    const { localeReady } = renderWithProviders(
      <SubstitutionDialog open onOpenChange={vi.fn()} onDone={onDone} />,
      { tenantId: 'tenant-1', locale: 'en' },
    );
    await localeReady;

    await screen.findByRole('option', { name: 'Class 6' });
    await user.selectOptions(screen.getByLabelText(/^class$/i), 'class-1');
    await screen.findByRole('option', { name: 'A' });
    await user.selectOptions(screen.getByLabelText(/^section$/i), 'section-1');
    await screen.findByRole('option', { name: 'Mon' });
    await user.selectOptions(screen.getByLabelText(/^slot$/i), 'slot-1');
    await user.type(screen.getByLabelText(/date/i), '2026-02-02');
    await screen.findByRole('option', { name: 'Ms Nahar' });
    await user.selectOptions(screen.getByLabelText(/substitute teacher/i), 'teacher-1');

    await user.click(screen.getByRole('button', { name: /^save$/i }));

    await waitFor(() => expect(posted).not.toBeNull());
    expect(posted).toMatchObject({
      routine_slot_id: 'slot-1',
      date: '2026-02-02',
      substitute_teacher_id: 'teacher-1',
      is_cancelled: false,
    });
    expect(onDone).toHaveBeenCalled();
  });

  it('surfaces the server rejection message verbatim when the date is not an occurrence', async () => {
    mockPickerData();
    server.use(
      http.post('/api/v1/routines/substitutions', () =>
        HttpResponse.json(
          {
            statusCode: 422,
            message: 'Routine slot "slot-1" does not occur on 2026-02-02',
            requestId: 'req-1',
          },
          { status: 422 },
        ),
      ),
    );
    const user = userEvent.setup();
    const { localeReady } = renderWithProviders(
      <SubstitutionDialog open onOpenChange={vi.fn()} onDone={vi.fn()} />,
      { tenantId: 'tenant-1', locale: 'en' },
    );
    await localeReady;

    await screen.findByRole('option', { name: 'Class 6' });
    await user.selectOptions(screen.getByLabelText(/^class$/i), 'class-1');
    await screen.findByRole('option', { name: 'A' });
    await user.selectOptions(screen.getByLabelText(/^section$/i), 'section-1');
    await screen.findByRole('option', { name: 'Mon' });
    await user.selectOptions(screen.getByLabelText(/^slot$/i), 'slot-1');
    await user.type(screen.getByLabelText(/date/i), '2026-02-02');

    await user.click(screen.getByRole('button', { name: /^save$/i }));

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('Routine slot "slot-1" does not occur on 2026-02-02');
  });
});

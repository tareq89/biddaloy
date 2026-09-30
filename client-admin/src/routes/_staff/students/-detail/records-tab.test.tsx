import { cleanupTestState, renderWithProviders, server, studentFactory } from '@biddaloy/ui/test';
import { screen, waitFor, within } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { afterEach, describe, expect, it } from 'vitest';

import { RecordsTab } from './records-tab';

/** [39.3.3] Records tab, rendered directly — it is not wired into the route yet. */
describe('students/-detail/records-tab', () => {
  afterEach(async () => {
    await cleanupTestState();
  });

  const exam = (over: Record<string, unknown> = {}) => ({
    id: 'exam-1',
    exam_type: 'SSC',
    board: 'Dhaka',
    roll_no: '123456',
    registration_no: '998877',
    gpa: '4.50',
    passing_year: 2024,
    ...over,
  });
  const event = (over: Record<string, unknown> = {}) => ({
    id: 'ev-1',
    event_type: 'WITHDRAWN',
    occurred_on: '2026-03-01',
    reason: 'Family moved',
    destination: null,
    remark: null,
    created_at: '2026-03-01T10:00:00.000Z',
    ...over,
  });

  function renderTab(
    opts: { role?: string; exams?: unknown[]; events?: unknown[]; eventsStatus?: number } = {},
  ) {
    const student = studentFactory({
      id: 'student-1',
      religion: 'Islam',
      birth_reg_no: '1234',
      father_name: 'Karim',
      mother_name: 'Amina',
      health_notes: 'Asthma',
    });
    let exams = opts.exams ?? [];
    server.use(
      http.get('/api/v1/students/:id', () => HttpResponse.json(student)),
      http.get('/api/v1/students/:id/public-exams', () => HttpResponse.json(exams)),
      http.delete('/api/v1/students/:id/public-exams/:examId', () => {
        exams = [];
        return new HttpResponse(null, { status: 204 });
      }),
      http.post('/api/v1/students/:id/public-exams', async ({ request }) => {
        const body = (await request.json()) as Record<string, unknown>;
        const created = exam({ ...body, id: 'exam-new', gpa: null });
        exams = [created];
        return HttpResponse.json(created, { status: 201 });
      }),
      http.get('/api/v1/students/:id/lifecycle-events', () =>
        opts.eventsStatus
          ? HttpResponse.json(
              {
                statusCode: opts.eventsStatus,
                message: 'Forbidden',
                timestamp: new Date().toISOString(),
                path: '/api/v1/students/student-1/lifecycle-events',
                requestId: 'req-1',
              },
              { status: opts.eventsStatus },
            )
          : HttpResponse.json(opts.events ?? []),
      ),
    );
    return renderWithProviders(<RecordsTab studentId="student-1" />, {
      tenantId: 'tenant-1',
      role: opts.role ?? 'ADMIN',
      locale: 'en',
    });
  }

  it('shows empty states for exams and timeline', async () => {
    renderTab();
    expect(await screen.findByText('No lifecycle events yet')).toBeTruthy();
    expect(await screen.findByText('No public exams recorded yet')).toBeTruthy();
  });

  it('shows 403 message when the timeline is forbidden', async () => {
    renderTab({ eventsStatus: 403 });
    expect(await screen.findByText(/do not have access/i)).toBeTruthy();
  });

  it('is editable with write permission', async () => {
    renderTab({ role: 'ADMIN' });
    const religion = await screen.findByLabelText('Religion');
    expect(religion.hasAttribute('readonly')).toBe(false);
    expect(screen.getByRole('button', { name: 'Save' })).toBeTruthy();
    expect(screen.getByLabelText('Health notes')).toBeTruthy();
  });

  it('is read-only with read but no write permission (health notes visible)', async () => {
    renderTab({ role: 'TEACHER', exams: [exam()] });
    const religion = await screen.findByLabelText('Religion');
    expect(religion.hasAttribute('readonly')).toBe(true);
    expect(screen.queryByRole('button', { name: 'Save' })).toBeNull();
    expect(screen.getByLabelText('Health notes')).toBeTruthy();
    await screen.findByText('Dhaka');
    expect(screen.queryByRole('button', { name: 'Add exam' })).toBeNull();
  });

  it('hides health notes without STUDENT_RECORDS_READ', async () => {
    renderTab({ role: 'ACCOUNTANT' });
    await screen.findByLabelText('Religion');
    expect(screen.queryByLabelText('Health notes')).toBeNull();
  });

  it('adds an exam', async () => {
    const { user } = renderTab();
    await user.click(await screen.findByRole('button', { name: 'Add exam' }));
    const dialog = await screen.findByRole('dialog');
    await user.type(within(dialog).getByLabelText('Board'), 'Dhaka');
    await user.type(within(dialog).getByLabelText('Roll no.'), '111');
    await user.type(within(dialog).getByLabelText('Registration no.'), '222');
    await user.type(within(dialog).getByLabelText('Passing year'), '2024');
    await user.click(within(dialog).getByRole('button', { name: 'Save' }));
    expect(await screen.findByText('222')).toBeTruthy();
  });

  it('sends gpa: null when an existing GPA is erased, and omits it when blank on create', async () => {
    const bodies: Record<string, unknown>[] = [];
    const { user } = renderTab({ exams: [exam()] });
    // After renderTab so these win over its default handlers.
    server.use(
      http.patch('/api/v1/students/:id/public-exams/:examId', async ({ request }) => {
        bodies.push((await request.json()) as Record<string, unknown>);
        return HttpResponse.json(exam({ gpa: null }));
      }),
      http.post('/api/v1/students/:id/public-exams', async ({ request }) => {
        bodies.push((await request.json()) as Record<string, unknown>);
        return HttpResponse.json(exam({ id: 'exam-new', gpa: null }), { status: 201 });
      }),
    );
    await user.click(await screen.findByRole('button', { name: 'Edit' }));
    let dialog = await screen.findByRole('dialog');
    await user.clear(within(dialog).getByLabelText('GPA'));
    await user.click(within(dialog).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(bodies).toHaveLength(1));
    expect(bodies[0]).toHaveProperty('gpa', null);
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());

    await user.click(screen.getByRole('button', { name: 'Add exam' }));
    dialog = await screen.findByRole('dialog');
    await user.type(within(dialog).getByLabelText('Board'), 'Dhaka');
    await user.type(within(dialog).getByLabelText('Roll no.'), '111');
    await user.type(within(dialog).getByLabelText('Registration no.'), '222');
    await user.type(within(dialog).getByLabelText('Passing year'), '2024');
    await user.click(within(dialog).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(bodies).toHaveLength(2));
    expect(bodies[1]).not.toHaveProperty('gpa');
  });

  it('deletes an exam', async () => {
    const { user } = renderTab({ exams: [exam()] });
    await user.click(await screen.findByRole('button', { name: 'Delete' }));
    const dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: 'Delete' }));
    await waitFor(() => expect(screen.queryByText('Dhaka')).toBeNull());
  });

  it('lists lifecycle events newest first', async () => {
    renderTab({
      events: [
        event({ id: 'a', occurred_on: '2025-01-01', reason: 'Older one' }),
        event({
          id: 'b',
          occurred_on: '2026-03-01',
          reason: 'Newer one',
          event_type: 'READMITTED',
        }),
      ],
    });
    await screen.findByText('Newer one');
    const items = screen.getAllByRole('listitem');
    expect(items[0]?.textContent).toContain('Newer one');
    expect(items[1]?.textContent).toContain('Older one');
  });

  it('is axe clean', async () => {
    const { container } = renderTab({ exams: [exam()], events: [event()] });
    await screen.findByText('Family moved');
    await screen.findByText('Dhaka');
    await expect(container).toHaveNoViolations();
  });
});

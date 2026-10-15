import {
  cleanupTestState,
  classFactory,
  classSectionFactory,
  renderWithRouter,
  server,
  studentFactory,
} from '@biddaloy/ui/test';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';

import { routeTree } from '../../routeTree.gen';

// The browser clock is a different day from the response's `today` on purpose.
vi.useFakeTimers({ toFake: ['Date'] });
afterAll(() => {
  vi.useRealTimers();
});
vi.setSystemTime(new Date('2030-01-01T05:00:00.000Z'));

const FATIMA_ID = '3fa85f64-5717-4562-b3fc-2c963f66afa6';
const IMRAN_ID = '9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d';

/** [8.10.7.5.10] `/portal/homework` through the real route tree, family endpoint only. */
describe('/portal/homework', () => {
  afterEach(async () => {
    await cleanupTestState();
  });

  const child = (name: string, id: string, roll: number) =>
    studentFactory({
      id,
      full_name: name,
      roll_number: roll,
      class_section: classSectionFactory({ class: classFactory({ name: 'Class 8' }) }),
    });
  const fatima = child('Fatima Rahman', FATIMA_ID, 14);
  const imran = child('Imran Rahman', IMRAN_ID, 7);

  const item = (id: string, title: string, due: string, extra: Record<string, unknown> = {}) => ({
    assignment_id: id,
    title,
    description: null,
    subject_name_en: 'Mathematics',
    subject_name_bn: 'গণিত',
    assigned_date: '2026-10-06',
    due_date: due,
    ...extra,
  });

  const requested: string[] = [];
  function mock(options: {
    students?: unknown[];
    byStudent?: Record<string, unknown>;
    error?: boolean;
  }) {
    requested.length = 0;
    server.use(
      http.get('/api/v1/students/mine', () => HttpResponse.json(options.students ?? [fatima])),
      http.get('/api/v1/students/:id/homework', ({ params }) => {
        requested.push(String(params.id));
        if (options.error) return HttpResponse.json({ message: 'boom' }, { status: 500 });
        return HttpResponse.json(
          options.byStudent?.[String(params.id)] ?? { today: '2026-10-07', items: [] },
        );
      }),
    );
  }

  const render = (path = '/portal/homework', locale = 'en') =>
    renderWithRouter(routeTree, {
      initialEntries: [path],
      tenantId: 'tenant-1',
      role: 'PARENT',
      locale,
    });

  it('labels due today / tomorrow / later from the response today, not the browser clock', async () => {
    mock({
      byStudent: {
        [FATIMA_ID]: {
          today: '2026-10-07',
          items: [
            item('a', 'Later task', '2026-10-20'),
            item('b', 'Today task', '2026-10-07'),
            item('c', 'Tomorrow task', '2026-10-08', { description: 'Do 1 to 8' }),
          ],
        },
      },
    });
    render();

    expect(await screen.findByRole('heading', { level: 2, name: 'Due today' })).toBeTruthy();
    expect(screen.getByRole('heading', { level: 2, name: 'Due tomorrow' })).toBeTruthy();
    expect(screen.getByRole('heading', { level: 2, name: /^Due .*2026/ })).toBeTruthy();
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
    expect(screen.getByText('Do 1 to 8')).toBeTruthy();
    const headings = screen.getAllByRole('heading', { level: 2 }).map((h) => h.textContent);
    expect(headings[0]).toBe('Due today');
  });

  it('two children: picker, and ?student= loads that child only', async () => {
    mock({
      students: [fatima, imran],
      byStudent: {
        [IMRAN_ID]: { today: '2026-10-07', items: [item('x', 'Imran task', '2026-10-07')] },
      },
    });
    render(`/portal/homework?student=${IMRAN_ID}`);

    expect(await screen.findByText('Imran task')).toBeTruthy();
    const picker = screen.getByRole('navigation', { name: 'Choose a student' });
    expect(within(picker).getByRole('link', { name: /Fatima Rahman/ })).toBeTruthy();
    expect(requested).toEqual([IMRAN_ID]);
  });

  it('shows the subject name in the active locale', async () => {
    mock({
      byStudent: { [FATIMA_ID]: { today: '2026-10-07', items: [item('a', 'T', '2026-10-07')] } },
    });
    render('/portal/homework', 'bn');
    expect(await screen.findByText('গণিত')).toBeTruthy();
    expect(screen.queryByText('Mathematics')).toBeNull();
  });

  it('empty list shows the empty state', async () => {
    mock({});
    render();
    expect(await screen.findByText('No homework due')).toBeTruthy();
  });

  it('a 500 shows the error state and Retry refetches', async () => {
    mock({ error: true });
    const user = userEvent.setup();
    render();
    const retry = await screen.findByRole('button', { name: 'Try again' }, { timeout: 5000 });
    expect(screen.getByText('Homework could not load.')).toBeTruthy();
    const before = requested.length;
    await user.click(retry);
    await waitFor(() => expect(requested.length).toBeGreaterThan(before));
    expect(within(document.body).getAllByRole('heading', { level: 1 })).toHaveLength(1);
  });

  it('is axe clean', async () => {
    mock({
      byStudent: { [FATIMA_ID]: { today: '2026-10-07', items: [item('a', 'T', '2026-10-07')] } },
    });
    const { container } = render();
    await screen.findByText('T');
    await expect(container).toHaveNoViolations();
  });
});

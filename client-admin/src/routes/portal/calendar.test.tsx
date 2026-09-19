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

// Frozen so "this month" means the same thing at 00:07 and at 14:00 — same
// reasoning `attendance.test.tsx` documents for its own clock.
vi.useFakeTimers({ toFake: ['Date'] });

afterAll(() => {
  vi.useRealTimers();
});

vi.setSystemTime(new Date('2026-09-15T10:00:00.000Z'));

const FATIMA_ID = '3fa85f64-5717-4562-b3fc-2c963f66afa6';
const IMRAN_ID = '9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d';
const CLASS_8_ID = 'a1a1a1a1-0000-0000-0000-000000000001';
const CLASS_3_ID = 'b2b2b2b2-0000-0000-0000-000000000002';

const SETTINGS = { firstDayOfWeek: 0, weeklyOffDays: [5, 6] };

function event(overrides: {
  id: string;
  type: 'HOLIDAY' | 'EXAM' | 'EVENT' | 'MEETING' | 'DEADLINE';
  name: string;
  start_date: string;
  end_date: string;
}) {
  return {
    ...overrides,
    description: null,
    start_time: null,
    end_time: null,
    counts_as_working_day: overrides.type !== 'HOLIDAY',
    class_ids: [],
    audience: 'ALL',
    is_locked: false,
    published: true,
  };
}

/**
 * [17.5.2]'s portal calendar — exercised through the real route tree,
 * same reasoning `attendance.test.tsx` documents for itself.
 */
describe('/portal/calendar', () => {
  afterEach(async () => {
    await cleanupTestState();
    vi.unstubAllGlobals();
  });

  function child(name: string, id: string, className: string, classId: string, roll: number) {
    return studentFactory({
      id,
      full_name: name,
      roll_number: roll,
      class_section: classSectionFactory({
        section_name: 'A',
        class: classFactory({ id: classId, name: className }),
        class_id: classId,
      }),
    });
  }

  const eventsRequests: { classId: string | null }[] = [];

  function mockCalendar(options: {
    students: unknown[];
    eventsByClass: Record<string, unknown[]>;
  }) {
    eventsRequests.length = 0;
    server.use(
      http.get('/api/v1/students/mine', () => HttpResponse.json(options.students)),
      http.get('/api/v1/calendar-settings', () => HttpResponse.json(SETTINGS)),
      http.get('/api/v1/calendar/events', ({ request }) => {
        const classId = new URL(request.url).searchParams.get('class_id');
        eventsRequests.push({ classId });
        const data = classId ? (options.eventsByClass[classId] ?? []) : [];
        return HttpResponse.json({ data, total: data.length, page: 1, limit: 100, totalPages: 1 });
      }),
    );
  }

  function renderCalendar(path = '/portal/calendar', locale = 'en') {
    return renderWithRouter(routeTree, {
      initialEntries: [path],
      tenantId: 'tenant-1',
      role: 'PARENT',
      locale,
    });
  }

  const fatima = child('Fatima Rahman', FATIMA_ID, 'Class 8', CLASS_8_ID, 14);
  const imran = child('Imran Rahman', IMRAN_ID, 'Class 3', CLASS_3_ID, 7);

  it('renders the default (first-linked) child class-scoped events', async () => {
    mockCalendar({
      students: [fatima, imran],
      eventsByClass: {
        [CLASS_8_ID]: [
          event({
            id: 'e1',
            type: 'EXAM',
            name: 'Class 8 mid-terms',
            start_date: '2026-09-10',
            end_date: '2026-09-10',
          }),
        ],
      },
    });
    renderCalendar();

    await screen.findAllByText('Class 8 mid-terms');
    expect(eventsRequests.at(-1)?.classId).toBe(CLASS_8_ID);
  });

  it('refetches with the new class filter when the child switches', async () => {
    mockCalendar({
      students: [fatima, imran],
      eventsByClass: {
        [CLASS_8_ID]: [
          event({
            id: 'e1',
            type: 'EXAM',
            name: 'Class 8 mid-terms',
            start_date: '2026-09-10',
            end_date: '2026-09-10',
          }),
        ],
        [CLASS_3_ID]: [
          event({
            id: 'e2',
            type: 'EVENT',
            name: 'Class 3 sports day',
            start_date: '2026-09-12',
            end_date: '2026-09-12',
          }),
        ],
      },
    });
    renderCalendar();

    await screen.findAllByText('Class 8 mid-terms');
    expect(eventsRequests.map((r) => r.classId)).toContain(CLASS_8_ID);

    const picker = await screen.findByRole('navigation', { name: 'Choose a student' });
    await userEvent.click(within(picker).getByRole('link', { name: /Imran Rahman/ }));

    await waitFor(() => expect(eventsRequests.map((r) => r.classId)).toContain(CLASS_3_ID));
    await screen.findAllByText('Class 3 sports day');
  });

  it('renders no picker when the caller can see exactly one student', async () => {
    mockCalendar({ students: [fatima], eventsByClass: { [CLASS_8_ID]: [] } });
    renderCalendar();

    await screen.findByRole('heading', { level: 1, name: 'Calendar' });
    expect(screen.queryByRole('navigation', { name: 'Choose a student' })).toBeNull();
  });

  it('renders no mutation controls anywhere on the route', async () => {
    mockCalendar({
      students: [fatima],
      eventsByClass: {
        [CLASS_8_ID]: [
          event({
            id: 'e1',
            type: 'HOLIDAY',
            name: 'National Day',
            start_date: '2026-09-05',
            end_date: '2026-09-05',
          }),
        ],
      },
    });
    renderCalendar();

    await screen.findAllByText('National Day');
    expect(screen.queryByRole('button', { name: /add|create|edit|delete|publish/i })).toBeNull();
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('explains an account with no students linked to it', async () => {
    mockCalendar({ students: [], eventsByClass: {} });
    renderCalendar();

    expect(await screen.findByText('No students linked to you yet')).toBeTruthy();
    expect(eventsRequests).toHaveLength(0);
  });

  it('shows a retryable error, with no h1, when the events fetch fails', async () => {
    server.use(
      http.get('/api/v1/students/mine', () => HttpResponse.json([fatima])),
      http.get('/api/v1/calendar-settings', () => HttpResponse.json(SETTINGS)),
      http.get('/api/v1/calendar/events', () =>
        HttpResponse.json({ message: 'boom' }, { status: 500 }),
      ),
    );
    renderCalendar();

    expect(
      await screen.findByText(/Could not load the school calendar/, {}, { timeout: 15000 }),
    ).toBeTruthy();
    expect(screen.queryByRole('heading', { level: 1 })).toBeNull();
  });

});

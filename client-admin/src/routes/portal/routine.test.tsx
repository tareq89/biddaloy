import { REGION_BD_EN } from '@biddaloy/ui/i18n';
import {
  cleanupTestState,
  classFactory,
  classSectionFactory,
  renderWithRouter,
  server,
  studentFactory,
} from '@biddaloy/ui/test';
import { formatDate, formatWeekday } from '@biddaloy/ui/utils';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';

import { routeTree } from '../../routeTree.gen';

// Same "frozen clock at collection time" reasoning `fees.test.tsx` documents
// for its own fixtures.
vi.useFakeTimers({ toFake: ['Date'] });
afterAll(() => {
  vi.useRealTimers();
});
vi.setSystemTime(new Date('2026-09-23T09:00:00.000Z'));

afterEach(async () => {
  await cleanupTestState();
});

function child(name: string, id: string, className: string, section: string, roll: number) {
  return studentFactory({
    id,
    full_name: name,
    roll_number: roll,
    // academic_year_id 'year-1' matches ROUTINE's own year below —
    // hasPublishableRoutine now scopes to the selected child's class
    // year, so a mismatched random factory year would hide the routine.
    class_section: classSectionFactory({
      section_name: section,
      class: classFactory({ name: className, academic_year_id: 'year-1' }),
    }),
  });
}

/** Families get a 403 from both of these, which fires the global "no
 * permission" toast — the page must never ask. */
const forbiddenHits: string[] = [];

function mockCommonLookups() {
  forbiddenHits.length = 0;
  server.use(
    http.get('/api/v1/subjects', () => {
      forbiddenHits.push('/subjects');
      return HttpResponse.json({ message: 'Forbidden' }, { status: 403 });
    }),
    http.get('/api/v1/teachers', () => {
      forbiddenHits.push('/teachers');
      return HttpResponse.json({ message: 'Forbidden' }, { status: 403 });
    }),
    http.get('/api/v1/routines/rooms', () =>
      HttpResponse.json({ data: [], total: 0, page: 1, limit: 100, totalPages: 0 }),
    ),
    http.get('/api/v1/routines/shifts', () =>
      HttpResponse.json({
        data: [{ id: 'shift-1' }],
        total: 1,
        page: 1,
        limit: 100,
        totalPages: 1,
      }),
    ),
    http.get('/api/v1/routines/shifts/:shiftId/period-slots', () =>
      HttpResponse.json([
        {
          id: 'period-1',
          sequence: 1,
          kind: 'CLASS',
          name: null,
          starts_at: '08:00:00',
          ends_at: '08:45:00',
        },
        {
          id: 'period-2',
          sequence: 2,
          kind: 'CLASS',
          name: null,
          starts_at: '08:45:00',
          ends_at: '09:30:00',
        },
      ]),
    ),
    http.get('/api/v1/calendar-settings', () =>
      HttpResponse.json({
        termLabel: 'TERM',
        country: 'BD',
        firstDayOfWeek: 0,
        weeklyOffDays: [5],
        timezone: 'Asia/Dhaka',
      }),
    ),
    http.get('/api/v1/calendar/events', () =>
      HttpResponse.json({ data: [], total: 0, page: 1, limit: 100, totalPages: 0 }),
    ),
    http.get('/api/v1/routines/resolve', () => HttpResponse.json([])),
  );
}

const ROUTINE = { id: 'routine-1', academic_year_id: 'year-1', created_at: '2026-01-01T00:00:00Z' };
const SLOT_UUID = '7c9e6679-7425-40de-944b-e07fc1f90ae7';
const SUBJECT_UUID = '0b8f1c52-3a64-4b8e-9d0a-5f2f6f0a9d11';

function slot(overrides: Record<string, unknown> = {}) {
  return {
    date: '2026-09-23',
    routine_slot_id: SLOT_UUID,
    section_id: 'section-1',
    period_slot_id: 'period-1',
    weekday: 3,
    subject_id: SUBJECT_UUID,
    subject_name_en: 'English',
    subject_name_bn: 'ইংরেজি',
    room_id: null,
    kind: 'CLASS',
    teacher_ids: [],
    substituted: false,
    cancelled: false,
    ...overrides,
  };
}

function renderRoutine(locale = 'en') {
  return renderWithRouter(routeTree, {
    initialEntries: ['/portal/routine'],
    tenantId: 'tenant-1',
    role: 'PARENT',
    locale,
  });
}

function mockPublished(
  slots: unknown[],
  students = [child('Fatima', 'student-1', 'Class 6', 'A', 12)],
) {
  mockCommonLookups();
  server.use(
    http.get('/api/v1/students/mine', () => HttpResponse.json(students)),
    http.get('/api/v1/routines', () => HttpResponse.json([{ ...ROUTINE, state: 'PUBLISHED' }])),
    http.get('/api/v1/routines/resolve', ({ request }) => {
      const studentId = new URL(request.url).searchParams.get('student_id');
      return HttpResponse.json(studentId === 'student-1' ? slots : []);
    }),
  );
}

describe('/portal/routine', () => {
  it("says the school hasn't published a routine yet when none exists", async () => {
    mockCommonLookups();
    const fatima = child('Fatima', 'student-1', 'Class 6', 'A', 12);
    server.use(
      http.get('/api/v1/students/mine', () => HttpResponse.json([fatima])),
      http.get('/api/v1/routines', () => HttpResponse.json([{ ...ROUTINE, state: 'DRAFT' }])),
    );

    renderRoutine();

    expect(await screen.findByRole('heading', { level: 2, name: 'No routine yet' })).toBeTruthy();
    expect(screen.getByText("The school hasn't published a routine yet.")).toBeTruthy();
    expect(screen.getAllByRole('heading', { level: 1 }).map((h) => h.textContent)).toEqual([
      'Routine',
    ]);
  });

  it("renders the resolved student's section day, and switches child via the fees-portal picker", async () => {
    mockPublished(
      [slot()],
      [
        child('Fatima', 'student-1', 'Class 6', 'A', 12),
        child('Rafi', 'student-2', 'Class 4', 'B', 3),
      ],
    );

    renderRoutine();

    expect(await screen.findByText('English')).toBeTruthy();
    expect(screen.getByText('Fatima · Class 6 A · Roll 12')).toBeTruthy();

    await userEvent.click(screen.getByRole('link', { name: /rafi/i }));
    expect(await screen.findByText('No periods.')).toBeTruthy();
  });

  it('makes no request to /subjects or /teachers', async () => {
    mockPublished([slot()]);

    renderRoutine();

    await screen.findByText('English');
    expect(forbiddenHits).toEqual([]);
  });

  it('offers seven day tabs from today, shows the period times, and no week-view toggle', async () => {
    mockPublished([slot()]);

    renderRoutine();

    const tablist = await screen.findByRole('tablist', { name: 'Choose a day' });
    const tabs = within(tablist).getAllByRole('tab');
    expect(tabs).toHaveLength(7);
    expect(tabs[0]?.textContent).toBe('Today');
    expect(screen.queryByRole('button', { name: /week view|day view/i })).toBeNull();

    expect(
      screen.getByRole('heading', {
        level: 2,
        name: `${formatWeekday('2026-09-23', REGION_BD_EN)}, ${formatDate('2026-09-23', REGION_BD_EN)}`,
      }),
    ).toBeTruthy();
    expect(screen.getByText('1 period')).toBeTruthy();
    expect(screen.getByText('8:00 AM')).toBeTruthy();
    expect(screen.getByText('until 8:45 AM')).toBeTruthy();
    expect(screen.getByText('Period 1')).toBeTruthy();
  });

  it('shows another day when its tab is selected', async () => {
    mockPublished([
      slot(),
      slot({
        date: '2026-09-24',
        routine_slot_id: 'slot-2',
        period_slot_id: 'period-2',
        subject_name_en: 'Science',
      }),
    ]);

    renderRoutine();

    await screen.findByText('English');
    await userEvent.click(screen.getByRole('tab', { name: /24/ }));

    expect(await screen.findByText('Science')).toBeTruthy();
    expect(screen.queryByText('English')).toBeNull();
    expect(
      screen.getByRole('heading', {
        level: 2,
        name: `${formatWeekday('2026-09-24', REGION_BD_EN)}, ${formatDate('2026-09-24', REGION_BD_EN)}`,
      }),
    ).toBeTruthy();
  });

  it('marks a cancelled period and strikes its subject through', async () => {
    mockPublished([slot({ cancelled: true })]);

    renderRoutine();

    const subject = await screen.findByText('English');
    expect(subject.className).toContain('line-through');
    const row = subject.closest('li') as HTMLElement;
    expect(within(row).getByText('Cancelled')).toBeTruthy();
  });

  it('marks a substituted period "Substitute teacher"', async () => {
    mockPublished([slot({ substituted: true })]);

    renderRoutine();

    expect(await screen.findByText('Substitute teacher')).toBeTruthy();
    expect(screen.queryByText('Cancelled')).toBeNull();
  });

  it('shows the Bangla subject name in Bangla', async () => {
    mockPublished([slot()]);

    const { localeReady } = renderRoutine('bn');
    await localeReady;

    expect(await screen.findByText('ইংরেজি')).toBeTruthy();
    expect(screen.queryByText('English')).toBeNull();
  });

  it('never shows a subject or period-slot id when the server sends no subject name', async () => {
    mockPublished([slot({ subject_name_en: null, subject_name_bn: null })]);

    renderRoutine();

    // The period label stands in as the title.
    expect(await screen.findByText('Period 1')).toBeTruthy();
    expect(document.body.textContent).not.toContain(SUBJECT_UUID);
    expect(document.body.textContent).not.toContain(SLOT_UUID);
    expect(document.body.textContent).not.toContain('period-1');
  });

  it('is axe clean', async () => {
    mockPublished([slot()]);

    const { container } = renderRoutine();

    await screen.findByText('English');
    await expect(container).toHaveNoViolations();
  });
});

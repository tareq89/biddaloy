import { apiErrorBody, cleanupTestState, renderWithRouter, server } from '@biddaloy/ui/test';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { routeTree } from '../../../../routeTree.gen';
import { ENTITY_RESOLVERS } from '../../../../use-breadcrumbs';

import { lessonItems, planFactory, scheduleFactory, scheduleLesson } from './-detail/test-fixtures';

const notifyOutcome = vi.hoisted(() => vi.fn());
vi.mock('@biddaloy/ui/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@biddaloy/ui/api')>()),
  notifyOutcome,
}));

type Plan = ReturnType<typeof planFactory>;
type Schedule = ReturnType<typeof scheduleFactory>;

function mockPlan(plan: Plan, schedule: Schedule) {
  server.use(
    http.get('/api/v1/study-plans/:id', () => HttpResponse.json(plan)),
    http.get('/api/v1/study-plans/:id/schedule', () => HttpResponse.json(schedule)),
    http.get('/api/v1/syllabus-topics', () =>
      HttpResponse.json([{ id: 'topic-1', name: 'Decimals' }]),
    ),
  );
}

function renderPage() {
  return renderWithRouter(routeTree, {
    initialEntries: ['/academics/study-plans/plan-1'],
    tenantId: 'tenant-1',
    role: 'ADMIN',
    locale: 'en',
  });
}

const doneSchedule = (summary: Partial<Schedule['summary']> = {}) =>
  scheduleFactory(
    [
      scheduleLesson('l1', 'DONE'),
      scheduleLesson('l2', 'IN_PROGRESS'),
      scheduleLesson('l3', 'UPCOMING'),
    ],
    summary,
  );

describe('/academics/study-plans/$planId', () => {
  afterEach(async () => {
    notifyOutcome.mockReset();
    await cleanupTestState();
  });

  it('shows the header facts: name, owner, term range, progress and capacity', async () => {
    mockPlan(planFactory(), doneSchedule({ lessons_done: 1, lessons_total: 3 }));
    renderPage();

    await screen.findByRole('heading', { level: 1, name: 'Class 7-A · Mathematics · First term' });
    expect(screen.getByText('Rahima Akter')).toBeTruthy();
    expect(await screen.findByText(/১লা জানুয়ারি – ৩০শে জুন/)).toBeTruthy();
    expect(await screen.findByText('১/৩ lessons')).toBeTruthy();
    expect(screen.getByText(/৫৮ · the remaining lessons need ৬২/)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Add lesson' })).toBeTruthy();
  });

  it.each([
    [{ periods_behind: 0, lessons_behind: 0 }, 'On track', 'text-status-paid-fg'],
    [
      { periods_behind: 1, lessons_behind: 0 },
      '১ periods behind (≈০ lessons)',
      'text-status-due-fg',
    ],
    [
      { periods_behind: 4, lessons_behind: 2 },
      '৪ periods behind (≈২ lessons)',
      'text-status-overdue-fg',
    ],
  ])('behind badge %j reads %s', async (summary, text, toneClass) => {
    mockPlan(planFactory(), doneSchedule(summary));
    renderPage();

    const badge = (await screen.findByText(text)).closest('span');
    expect(badge?.className).toContain(toneClass);
  });

  it('a read-only plan has no edit controls', async () => {
    mockPlan(planFactory({ can_edit: false }), doneSchedule());
    renderPage();

    await screen.findByText('Lesson 1');
    expect(screen.queryByRole('button', { name: 'Add lesson' })).toBeNull();
    expect(screen.queryByRole('button', { name: /^Move / })).toBeNull();
  });

  it('adds a lesson at the end with a new id and one period', async () => {
    mockPlan(planFactory(), doneSchedule());
    let body: { lessons: { id: string; title: string; periods: number }[] } | undefined;
    server.use(
      http.put('/api/v1/study-plans/:id/lessons', async ({ request }) => {
        body = (await request.json()) as typeof body;
        return HttpResponse.json(planFactory({ lessons: body!.lessons }));
      }),
    );
    renderPage();
    const user = userEvent.setup();

    await user.click(await screen.findByRole('button', { name: 'Add lesson' }));
    const dialog = await screen.findByRole('dialog');
    await user.type(within(dialog).getByLabelText(/Lesson title/), 'Fractions');
    expect(within(dialog).getByLabelText<HTMLInputElement>('Periods needed').value).toBe('1');
    await user.click(within(dialog).getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(body).toBeDefined());
    expect(body!.lessons).toHaveLength(4);
    expect(body!.lessons.at(-1)).toMatchObject({ title: 'Fractions', periods: 1 });
    expect(body!.lessons.at(-1)!.id).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('editing keeps the lesson id', async () => {
    mockPlan(planFactory(), doneSchedule());
    let body: { lessons: { id: string; title: string }[] } | undefined;
    server.use(
      http.put('/api/v1/study-plans/:id/lessons', async ({ request }) => {
        body = (await request.json()) as typeof body;
        return HttpResponse.json(planFactory({ lessons: body!.lessons as never }));
      }),
    );
    renderPage();
    const user = userEvent.setup();

    await screen.findByText('Lesson 2');
    await user.click(screen.getAllByRole('button', { name: 'Edit lesson' })[1]!);
    const dialog = await screen.findByRole('dialog');
    const title = within(dialog).getByLabelText(/Lesson title/);
    await user.clear(title);
    await user.type(title, 'Renamed');
    await user.click(within(dialog).getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(body).toBeDefined());
    expect(body!.lessons[1]).toMatchObject({ id: 'l2', title: 'Renamed' });
  });

  it('delete asks first, then sends the list without the lesson', async () => {
    mockPlan(planFactory(), doneSchedule());
    let body: { lessons: { id: string }[] } | undefined;
    server.use(
      http.put('/api/v1/study-plans/:id/lessons', async ({ request }) => {
        body = (await request.json()) as typeof body;
        return HttpResponse.json(planFactory({ lessons: body!.lessons as never }));
      }),
    );
    renderPage();
    const user = userEvent.setup();

    await screen.findByText('Lesson 2');
    await user.click(screen.getAllByRole('button', { name: 'Delete lesson' })[1]!);
    const dialog = await screen.findByRole('alertdialog');
    expect(within(dialog).getByText(/Delete lesson ২ 'Lesson 2'\?/)).toBeTruthy();
    expect(body).toBeUndefined();
    await user.click(within(dialog).getByRole('button', { name: 'Delete lesson' }));

    await waitFor(() => expect(body).toBeDefined());
    expect(body!.lessons.map((l) => l.id)).toEqual(['l1', 'l3']);
  });

  it('a 403 STUDY_PLAN_OUT_OF_SCOPE on save shows the translated scope sentence', async () => {
    mockPlan(planFactory(), doneSchedule());
    server.use(
      http.put('/api/v1/study-plans/:id/lessons', () =>
        HttpResponse.json(
          {
            ...apiErrorBody(403, 'Forbidden', '/api/v1/study-plans/plan-1/lessons'),
            details: { code: 'STUDY_PLAN_OUT_OF_SCOPE' },
          },
          { status: 403 },
        ),
      ),
    );
    renderPage();
    const user = userEvent.setup();

    await user.click(await screen.findByRole('button', { name: 'Move Lesson 1 down' }));

    await waitFor(() =>
      expect(notifyOutcome).toHaveBeenCalledWith(
        expect.objectContaining({
          variant: 'error',
          message: 'You can only change plans for the subjects you teach.',
        }),
      ),
    );
  });

  it('a dropped marker shows one info toast naming the exam', async () => {
    const plan = planFactory({
      exam_markers: [{ exam_id: 'e1', up_to_lesson_id: 'l2', exam_name: 'Half-yearly' }],
    });
    mockPlan(plan, doneSchedule());
    server.use(
      http.put('/api/v1/study-plans/:id/lessons', () =>
        HttpResponse.json(
          planFactory({
            lessons: lessonItems(2),
            dropped_markers: [{ exam_id: 'e1', up_to_lesson_id: 'l2' }],
          }),
        ),
      ),
    );
    renderPage();
    const user = userEvent.setup();

    await screen.findByText('Lesson 2');
    await user.click(screen.getAllByRole('button', { name: 'Delete lesson' })[1]!);
    const dialog = await screen.findByRole('alertdialog');
    await user.click(within(dialog).getByRole('button', { name: 'Delete lesson' }));

    await waitFor(() =>
      expect(notifyOutcome).toHaveBeenCalledWith(
        expect.objectContaining({
          variant: 'info',
          message: 'The Half-yearly marker was removed with that lesson.',
        }),
      ),
    );
  });

  it('shows the routine-not-published line with a link for users who can read routines', async () => {
    mockPlan(planFactory(), doneSchedule({ routine_missing: true }));
    renderPage();

    expect(
      await screen.findByText(/Dates appear once the class routine is published\./),
    ).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Open routines' }).getAttribute('href')).toBe(
      '/routines',
    );
  });

  it('shows an empty state with an add button when there are no lessons', async () => {
    mockPlan(planFactory({ lessons: [] }), scheduleFactory([]));
    renderPage();

    expect(await screen.findByText('No lessons yet')).toBeTruthy();
    expect(screen.getAllByRole('button', { name: 'Add lesson' }).length).toBeGreaterThan(0);
  });

  it('404 shows the error state', async () => {
    server.use(
      http.get('/api/v1/study-plans/:id', () =>
        HttpResponse.json(apiErrorBody(404, 'Not found', '/api/v1/study-plans/plan-1'), {
          status: 404,
        }),
      ),
      http.get('/api/v1/study-plans/:id/schedule', () =>
        HttpResponse.json(apiErrorBody(404, 'Not found', '/api/v1/study-plans/plan-1/schedule'), {
          status: 404,
        }),
      ),
    );
    renderPage();

    expect(await screen.findByText('Study plan not found.')).toBeTruthy();
  });

  it('the breadcrumb resolver returns the h1 string from the cached plan', () => {
    const name = ENTITY_RESOLVERS.studyPlanDetail!.getName(planFactory(), 'plan-1', {
      language: 'en',
      region: {} as never,
    });
    expect(name).toBe('Class 7-A · Mathematics · First term');
  });
});

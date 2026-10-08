import { cleanupTestState, renderWithRouter, server } from '@biddaloy/ui/test';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { routeTree } from '../../../../../routeTree.gen';

const notifyOutcome = vi.hoisted(() => vi.fn());
vi.mock('@biddaloy/ui/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@biddaloy/ui/api')>()),
  notifyOutcome,
}));

const today = new Date();
const iso = (offset: number) => {
  const d = new Date(today.getFullYear(), today.getMonth(), today.getDate() + offset);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

const TERMS = [
  {
    id: 't1',
    academic_year_id: 'y1',
    seq: 1,
    name: 'First term',
    start_date: iso(-200),
    end_date: iso(-30),
  },
  {
    id: 't2',
    academic_year_id: 'y1',
    seq: 2,
    name: 'Second term',
    start_date: iso(-29),
    end_date: iso(100),
  },
];

interface Calls {
  created: unknown[];
  copied: unknown[];
  committed: unknown[];
  puts: unknown[];
}
let calls: Calls;

function page(data: unknown[]) {
  return { data, total: data.length, page: 1, limit: 100, totalPages: 1 };
}

function handlers(
  opts: {
    terms?: unknown[];
    carry?: unknown[];
    createStatus?: { status: number; body: Record<string, unknown> };
    validate?: unknown;
    commitConflict?: boolean;
    putFails?: boolean;
  } = {},
) {
  calls = { created: [], copied: [], committed: [], puts: [] };
  const detail = (id: string, lessons: unknown[] = []) => ({
    id,
    lessons,
    section: {},
    subject: {},
    term: null,
    lesson_count: lessons.length,
    owners: [],
    can_edit: true,
    exam_markers: [],
  });
  server.use(
    http.get('/api/v1/academic-years', () =>
      HttpResponse.json(page([{ id: 'y1', name: '2026', is_current: true }])),
    ),
    http.get('/api/v1/calendar/terms', () => HttpResponse.json(opts.terms ?? TERMS)),
    http.get('/api/v1/schools/:id/settings', () => HttpResponse.json({ version: 1 })),
    http.get('/api/v1/classes', () =>
      HttpResponse.json(page([{ id: 'c1', name: 'Class 7', numeric_grade: 7 }])),
    ),
    http.get('/api/v1/classes/c1/sections', () =>
      HttpResponse.json([{ id: 'sec1', class_id: 'c1', section_name: 'B', enrolled_count: 3 }]),
    ),
    http.get('/api/v1/subjects', () =>
      HttpResponse.json(
        page([{ id: 'sub1', name_en: 'Mathematics', name_bn: null, code: 'MATH' }]),
      ),
    ),
    http.get('/api/v1/study-plans/capacity', () =>
      HttpResponse.json({ periods_left: 68, periods_needed: 0, fits: true }),
    ),
    http.get('/api/v1/study-plans/:id/carry-over', () =>
      HttpResponse.json({
        lessons: opts.carry ?? [{ id: 'old1', title: 'Leftover', periods: 2 }],
        from_term: { id: 't1', name: 'First term' },
      }),
    ),
    http.get('/api/v1/study-plans', () =>
      HttpResponse.json(
        page([
          {
            id: 'prev',
            section: { id: 'sec1', name: 'B', class_id: 'c1', class_name: 'Class 7' },
            subject: { id: 'sub1', name_en: 'Mathematics', name_bn: null, code: 'MATH' },
            term: { id: 't1', name: 'First term' },
            summary: {},
          },
        ]),
      ),
    ),
    http.get('/api/v1/study-plan-templates', () =>
      HttpResponse.json(
        page([
          {
            id: 'tpl1',
            name: 'Maths 7',
            class_grade: 7,
            subject_code: 'MATH',
            subject_name: 'Mathematics',
            lesson_count: 2,
            total_periods: 5,
            updated_at: new Date().toISOString(),
          },
        ]),
      ),
    ),
    http.get('/api/v1/study-plan-templates/tpl1', () =>
      HttpResponse.json({
        id: 'tpl1',
        lessons: [
          { id: 'l1', title: 'Numbers', periods: 2 },
          { id: 'l2', title: 'Algebra', periods: 3 },
        ],
      }),
    ),
    http.post('/api/v1/study-plans', async ({ request }) => {
      calls.created.push(await request.json());
      if (opts.createStatus) {
        return HttpResponse.json(opts.createStatus.body, { status: opts.createStatus.status });
      }
      return HttpResponse.json(detail('new1'), { status: 201 });
    }),
    http.post('/api/v1/study-plan-templates/tpl1/copy', async ({ request }) => {
      calls.copied.push(await request.json());
      return HttpResponse.json(
        detail('new2', [
          { id: 'n1', title: 'Numbers', periods: 2 },
          { id: 'n2', title: 'Algebra', periods: 3 },
        ]),
        { status: 201 },
      );
    }),
    http.put('/api/v1/study-plans/:id/lessons', async ({ request }) => {
      calls.puts.push(await request.json());
      if (opts.putFails) return HttpResponse.json({ message: 'x' }, { status: 500 });
      return HttpResponse.json(detail('new2'));
    }),
    http.post('/api/v1/study-plans/import/validate', () =>
      HttpResponse.json(
        opts.validate ?? {
          staging_id: 'stg1',
          expires_at: new Date(Date.now() + 600_000).toISOString(),
          rows_to_create: 1,
          preview: [{ row: 2, title: 'From csv', periods: 4 }],
          errors: [],
          warnings: [],
          hard_error_count: 0,
        },
        { status: 201 },
      ),
    ),
    http.post('/api/v1/study-plans/import/commit', async ({ request }) => {
      calls.committed.push(await request.json());
      if (opts.commitConflict) {
        return HttpResponse.json(
          {
            statusCode: 409,
            message: 'exists',
            timestamp: '',
            path: '',
            requestId: 'r',
            details: { code: 'STUDY_PLAN_EXISTS', existing_id: 'old8' },
          },
          { status: 409 },
        );
      }
      return HttpResponse.json(detail('new3', [{ id: 'c1', title: 'From csv', periods: 4 }]), {
        status: 201,
      });
    }),
  );
}

function render(entry = '/academics/syllabus?tab=plans&new=1', role = 'ADMIN') {
  return renderWithRouter(routeTree, {
    initialEntries: [entry],
    tenantId: 'tenant-1',
    role,
    locale: 'en',
  });
}

async function pick(user: ReturnType<typeof userEvent.setup>, name: string, option: string) {
  await user.click(await screen.findByRole('combobox', { name }));
  await user.click(await screen.findByRole('option', { name: option }));
}

async function fillScope(user: ReturnType<typeof userEvent.setup>, withClassSubject = true) {
  if (withClassSubject) {
    await pick(user, 'Class', 'Class 7');
    await pick(user, 'Subject', 'Mathematics');
  }
  await pick(user, 'Section', 'B');
}

// The footer button is last in the DOM (an error table may have its own pager Next).
const next = () => screen.getAllByRole('button', { name: 'Next' }).at(-1) as HTMLElement;

afterEach(async () => {
  await cleanupTestState();
});

describe('create study plan wizard', () => {
  it('Next stays disabled until section, subject and term are chosen', async () => {
    handlers();
    render();
    const user = userEvent.setup();
    await screen.findByRole('combobox', { name: 'Class' });
    expect((next() as HTMLButtonElement).disabled).toBe(true);
    await fillScope(user);
    await waitFor(() => expect((next() as HTMLButtonElement).disabled).toBe(false));
  });

  it('a year with no terms offers Whole year and saves academic_term_id: null', async () => {
    handlers({ terms: [] });
    const { router } = render();
    const user = userEvent.setup();
    await fillScope(user);
    await waitFor(() => expect((next() as HTMLButtonElement).disabled).toBe(false));
    expect(screen.getByRole('combobox', { name: 'Term' }).textContent).toContain('Whole year');
    await user.click(next());
    await user.click(await screen.findByRole('button', { name: 'Next' }));
    await user.click(await screen.findByRole('button', { name: 'Save plan' }));
    await waitFor(() => expect(calls.created).toHaveLength(1));
    expect(calls.created[0]).toMatchObject({
      section_id: 'sec1',
      subject_id: 'sub1',
      academic_term_id: null,
    });
    await waitFor(() => expect(router.state.location.pathname).toBe('/academics/study-plans/new1'));
  });

  it('Empty start saves the scope and goes to the new plan', async () => {
    handlers({ carry: [] });
    const { router } = render();
    const user = userEvent.setup();
    await fillScope(user);
    await user.click(next());
    expect(await screen.findByText('Where do the lessons come from?')).toBeTruthy();
    expect(screen.queryByText(/lessons? left from last term/)).toBeNull();
    await user.click(next());
    expect(await screen.findByText('You will add lessons on the plan page.')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Save plan' }));
    await waitFor(() => expect(calls.created[0]).toMatchObject({ academic_term_id: 't2' }));
    await waitFor(() => expect(router.state.location.pathname).toBe('/academics/study-plans/new1'));
  });

  it('?template=tpl1 opens Start on that template; carry-over lessons go first in the follow-up PUT', async () => {
    handlers();
    render('/academics/syllabus?tab=plans&new=1&template=tpl1&plan_class=c1&plan_subject=sub1');
    const user = userEvent.setup();
    await fillScope(user, false);
    await user.click(await waitFor(() => next()));
    const radio = await screen.findByRole('radio', { name: 'Maths 7' });
    await waitFor(() => expect(radio.getAttribute('aria-checked')).toBe('true'));
    await user.click(await screen.findByRole('checkbox'));
    await user.click(next());
    expect(await screen.findByText('Leftover')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Save plan' }));
    await waitFor(() => expect(calls.copied).toHaveLength(1));
    expect(calls.copied[0]).toMatchObject({ section_id: 'sec1', academic_term_id: 't2' });
    await waitFor(() => expect(calls.puts).toHaveLength(1));
    const lessons = (calls.puts[0] as { lessons: { title: string }[] }).lessons;
    expect(lessons.map((l) => l.title)).toEqual(['Leftover', 'Numbers', 'Algebra']);
  });

  it('an unticked preview row is left out of the saved lessons', async () => {
    handlers({ carry: [] });
    render('/academics/syllabus?tab=plans&new=1&template=tpl1&plan_class=c1&plan_subject=sub1');
    const user = userEvent.setup();
    await fillScope(user, false);
    await user.click(next());
    await screen.findByRole('radio', { name: 'Maths 7' });
    await user.click(next());
    await user.click(await screen.findByRole('checkbox', { name: 'Keep Algebra' }));
    await user.click(screen.getByRole('button', { name: 'Save plan' }));
    await waitFor(() => expect(calls.puts).toHaveLength(1));
    expect((calls.puts[0] as { lessons: { title: string }[] }).lessons.map((l) => l.title)).toEqual(
      ['Numbers'],
    );
  });

  it('CSV: a clean file is committed on Save', async () => {
    handlers({ carry: [] });
    render();
    const user = userEvent.setup({ applyAccept: false });
    await fillScope(user);
    await user.click(next());
    await user.click(await screen.findByRole('radio', { name: /From a CSV file/ }));
    await user.click(await screen.findByRole('button', { name: 'Choose file' }));
    await user.upload(
      screen.getByLabelText('Choose file'),
      new File(['title,periods\nFrom csv,4'], 'plan.csv', { type: 'text/csv' }),
    );
    await waitFor(() => expect((next() as HTMLButtonElement).disabled).toBe(false));
    await user.click(next());
    expect(await screen.findByText('From csv')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Save plan' }));
    await waitFor(() => expect(calls.committed).toHaveLength(1));
    expect(calls.committed[0]).toMatchObject({
      staging_id: 'stg1',
      plan: { section_id: 'sec1', subject_id: 'sub1', academic_term_id: 't2' },
    });
  });

  it('CSV: hard errors block Next', async () => {
    handlers({
      carry: [],
      validate: {
        staging_id: 'stg2',
        expires_at: new Date(Date.now() + 600_000).toISOString(),
        rows_to_create: 0,
        preview: [],
        errors: [{ row: 2, column: 'periods', message: 'Not a number', severity: 'error' }],
        warnings: [],
        hard_error_count: 1,
      },
    });
    render();
    const user = userEvent.setup({ applyAccept: false });
    await fillScope(user);
    await user.click(next());
    await user.click(await screen.findByRole('radio', { name: /From a CSV file/ }));
    await user.click(await screen.findByRole('button', { name: 'Choose file' }));
    await user.upload(
      screen.getByLabelText('Choose file'),
      new File(['title,periods\nx,y'], 'bad.csv', { type: 'text/csv' }),
    );
    expect(await screen.findByText('Not a number')).toBeTruthy();
    expect((next() as HTMLButtonElement).disabled).toBe(true);
  });

  it('the carry-over tick appears only when the earlier plan returns lessons', async () => {
    handlers({ carry: [] });
    render();
    const user = userEvent.setup();
    await fillScope(user);
    await user.click(next());
    await screen.findByText('Where do the lessons come from?');
    expect(screen.queryByRole('checkbox')).toBeNull();
  });

  it('409 shows the duplicate sentence with an "Open it" link', async () => {
    handlers({
      carry: [],
      createStatus: {
        status: 409,
        body: {
          statusCode: 409,
          message: 'exists',
          timestamp: '',
          path: '',
          requestId: 'r',
          details: { code: 'STUDY_PLAN_EXISTS', existing_id: 'old9' },
        },
      },
    });
    render();
    const user = userEvent.setup();
    await fillScope(user);
    await user.click(next());
    await user.click(await screen.findByRole('button', { name: 'Next' }));
    await user.click(await screen.findByRole('button', { name: 'Save plan' }));
    expect(await screen.findByText(/already has a plan for Mathematics/)).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Open it' }).getAttribute('href')).toBe(
      '/academics/study-plans/old9',
    );
  });

  it('403 shows the scope sentence', async () => {
    handlers({
      carry: [],
      createStatus: {
        status: 403,
        body: {
          statusCode: 403,
          message: 'no',
          timestamp: '',
          path: '',
          requestId: 'r',
          details: { code: 'STUDY_PLAN_OUT_OF_SCOPE' },
        },
      },
    });
    render();
    const user = userEvent.setup();
    await fillScope(user);
    await user.click(next());
    await user.click(await screen.findByRole('button', { name: 'Next' }));
    await user.click(await screen.findByRole('button', { name: 'Save plan' }));
    expect(await screen.findByText(/You don't teach Mathematics in/)).toBeTruthy();
  });

  it('Close and the first-step Back ask before discarding changes', async () => {
    handlers();
    render();
    const user = userEvent.setup();
    await fillScope(user);
    await user.click(screen.getByRole('button', { name: 'Back' }));
    const first = await screen.findByRole('alertdialog');
    expect(first).toBeTruthy();
    await user.click(within(first).getByRole('button', { name: /Keep editing/ }));
    await user.click(screen.getByRole('button', { name: 'Close' }));
    expect(await screen.findByRole('alertdialog')).toBeTruthy();
  });

  it('a role without SYLLABUS_MANAGE sees no wizard and `new` is removed from the URL', async () => {
    handlers();
    const { router } = render('/academics/syllabus?tab=plans&new=1', 'EXECUTIVE');
    await waitFor(() => expect(router.state.location.search).not.toHaveProperty('new'));
    expect(screen.queryByText('New study plan')).toBeNull();
  });

  async function csvToPreview(user: ReturnType<typeof userEvent.setup>) {
    await fillScope(user);
    await user.click(next());
    await user.click(await screen.findByRole('radio', { name: /From a CSV file/ }));
    await user.click(await screen.findByRole('button', { name: 'Choose file' }));
    await user.upload(
      screen.getByLabelText('Choose file'),
      new File(['title,periods\nFrom csv,4'], 'plan.csv', { type: 'text/csv' }),
    );
    await waitFor(() => expect((next() as HTMLButtonElement).disabled).toBe(false));
    await user.click(next());
  }

  it('CSV commit 409 shows the duplicate sentence with "Open it"', async () => {
    handlers({ carry: [], commitConflict: true });
    render();
    const user = userEvent.setup({ applyAccept: false });
    await csvToPreview(user);
    await user.click(await screen.findByRole('button', { name: 'Save plan' }));
    expect(await screen.findByText(/already has a plan for Mathematics/)).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Open it' }).getAttribute('href')).toBe(
      '/academics/study-plans/old8',
    );
  });

  it('a truncated CSV preview says so instead of undercounting', async () => {
    handlers({
      carry: [],
      validate: {
        staging_id: 'stg3',
        expires_at: new Date(Date.now() + 600_000).toISOString(),
        rows_to_create: 45,
        preview: [{ row: 2, title: 'From csv', periods: 4 }],
        errors: [],
        warnings: [{ row: 3, column: 'topic', message: 'Unknown topic', severity: 'warning' }],
        hard_error_count: 0,
      },
    });
    render();
    const user = userEvent.setup({ applyAccept: false });
    await csvToPreview(user);
    expect(await screen.findByText(/Showing the first .* of .* lessons/)).toBeTruthy();
  });

  it('unticked rows reset when the template changes', async () => {
    handlers({ carry: [] });
    render('/academics/syllabus?tab=plans&new=1&template=tpl1&plan_class=c1&plan_subject=sub1');
    const user = userEvent.setup();
    await fillScope(user, false);
    await user.click(next());
    await screen.findByRole('radio', { name: 'Maths 7' });
    await user.click(next());
    await user.click(await screen.findByRole('checkbox', { name: 'Keep Algebra' }));
    await user.click(screen.getByRole('button', { name: 'Back' }));
    await user.click(await screen.findByRole('radio', { name: /Start empty/ }));
    await user.click(screen.getByRole('radio', { name: /From the library/ }));
    await user.click(await screen.findByRole('radio', { name: 'Maths 7' }));
    await user.click(next());
    const keep = await screen.findByRole('checkbox', { name: 'Keep Algebra' });
    expect(keep.getAttribute('aria-checked')).toBe('true');
  });

  it('if the follow-up PUT fails the new plan is still opened and the user is told', async () => {
    notifyOutcome.mockClear();
    handlers({ putFails: true });
    const { router } = render(
      '/academics/syllabus?tab=plans&new=1&template=tpl1&plan_class=c1&plan_subject=sub1',
    );
    const user = userEvent.setup();
    await fillScope(user, false);
    await user.click(next());
    await screen.findByRole('radio', { name: 'Maths 7' });
    await user.click(await screen.findByRole('checkbox'));
    await user.click(next());
    await user.click(await screen.findByRole('button', { name: 'Save plan' }));
    await waitFor(() => expect(router.state.location.pathname).toBe('/academics/study-plans/new2'));
    expect(notifyOutcome).toHaveBeenCalledWith(
      expect.objectContaining({ message: expect.stringContaining('could not be applied') }),
    );
  });
});

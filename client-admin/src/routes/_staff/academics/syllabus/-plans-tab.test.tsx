import { cleanupTestState, renderWithRouter, server } from '@biddaloy/ui/test';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { afterEach, describe, expect, it } from 'vitest';

import { routeTree } from '../../../../routeTree.gen';

const today = new Date();
const iso = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const day = (offset: number) =>
  iso(new Date(today.getFullYear(), today.getMonth(), today.getDate() + offset));

function summary(over: Record<string, unknown> = {}) {
  return {
    lessons_done: 11,
    lessons_total: 40,
    periods_behind: 14,
    lessons_behind: 7,
    unreported_periods: 0,
    unreported_school_days: 0,
    oldest_unreported_date: null,
    last_reported_at: null,
    capacity: { periods_left: 10, periods_needed: 10, fits: true },
    routine_missing: false,
    ...over,
  };
}

function row(id: string, over: Record<string, unknown> = {}) {
  return {
    id,
    academic_year_id: 'y1',
    section: { id: 's1', name: 'খ', class_id: 'c1', class_name: '৭ম' },
    subject: { id: 'sub1', name_en: 'Mathematics', name_bn: 'গণিত', code: 'M' },
    term: { id: 't1', name: 'First term' },
    lesson_count: 40,
    summary: summary(),
    ...over,
  };
}

function page(rows: unknown[]) {
  return { data: rows, total: rows.length, page: 1, limit: 25, totalPages: 1 };
}

const seen: string[] = [];

function handlers(
  rows: unknown[],
  opts: { terms?: unknown[]; deleted?: string[]; fail?: boolean; settings?: unknown } = {},
) {
  seen.length = 0;
  server.use(
    http.get('/api/v1/academic-years', () =>
      HttpResponse.json({
        data: [{ id: 'y1', name: '2026', is_current: true }],
        total: 1,
        page: 1,
        limit: 25,
        totalPages: 1,
      }),
    ),
    http.get('/api/v1/calendar/terms', () =>
      HttpResponse.json(
        opts.terms ?? [
          {
            id: 't1',
            academic_year_id: 'y1',
            seq: 1,
            name: 'First term',
            start_date: day(-30),
            end_date: day(30),
          },
        ],
      ),
    ),
    http.get('/api/v1/schools/:id/settings', () =>
      HttpResponse.json(
        opts.settings ?? { version: 1, studyPlans: { escalateAfterSchoolDays: 2 } },
      ),
    ),
    http.get('/api/v1/classes', () =>
      HttpResponse.json({
        data: [{ id: 'c1', name: 'Class 7' }],
        total: 1,
        page: 1,
        limit: 100,
        totalPages: 1,
      }),
    ),
    http.get('/api/v1/subjects', () => HttpResponse.json(page([]))),
    http.get('/api/v1/study-plans', ({ request }) => {
      seen.push(new URL(request.url).search);
      if (opts.fail) return HttpResponse.json({ message: 'boom' }, { status: 500 });
      return HttpResponse.json(page(rows));
    }),
    http.delete('/api/v1/study-plans/:id', ({ params }) => {
      opts.deleted?.push(String(params.id));
      return new HttpResponse(null, { status: 204 });
    }),
  );
}

function render(
  entry = '/academics/syllabus?tab=plans',
  locale: 'en' | 'bn' = 'en',
  role = 'ADMIN',
) {
  return renderWithRouter(routeTree, {
    initialEntries: [entry],
    tenantId: 'tenant-1',
    role,
    locale,
  });
}

afterEach(async () => {
  await cleanupTestState();
});

describe('Syllabus › Study plans tab', () => {
  it('renders section, subject, term, progress and the behind badge', async () => {
    handlers([
      row('p1'),
      row('p2', { summary: summary({ periods_behind: 0, lessons_behind: 0 }) }),
    ]);
    render();
    expect((await screen.findAllByText('First term')).length).toBeGreaterThan(0);
    expect(screen.getAllByText('৭ম-খ').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Mathematics').length).toBeGreaterThan(0);
    expect(screen.getAllByText('11/40 lessons').length).toBeGreaterThan(0);
    expect(screen.getByText('14 periods behind (≈7 lessons)')).toBeTruthy();
    expect(screen.getByText('On track')).toBeTruthy();
    expect(screen.getByText('Most behind first')).toBeTruthy();
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
  });

  it('reporting cell: unreported days warn then escalate; otherwise shows the last report day', async () => {
    const ok = { periods_behind: 0, lessons_behind: 0 };
    handlers([
      row('a', { summary: summary({ ...ok, unreported_school_days: 1 }) }),
      row('b', { summary: summary({ ...ok, unreported_school_days: 2 }) }),
      row('c', { summary: summary({ ...ok, last_reported_at: day(0) }) }),
      row('d', { summary: summary({ ...ok, last_reported_at: day(-1) }) }),
      row('e', { summary: summary({ ...ok, last_reported_at: day(-5) }) }),
      row('f', { summary: summary({ ...ok, last_reported_at: null }) }),
    ]);
    render();
    await screen.findByText('1 day not reported');
    const rows = screen.getAllByRole('row');
    const cell = (i: number) => rows[i + 1]?.textContent ?? '';
    expect(cell(0)).toContain('1 day not reported');
    expect(cell(1)).toContain('2 day not reported');
    expect(cell(2)).toContain('Today');
    expect(cell(3)).toContain('Yesterday');
    expect(cell(4)).not.toMatch(/Today|Yesterday|—/);
    expect(cell(4)).toMatch(/[0-9০-৯]{4}/); // a long date with a year
    expect(cell(5)).toContain('—');
  });

  it('Class, Term and Behind-only write plan_* keys and are sent to the API', async () => {
    handlers([row('p1')]);
    const { router } = render();
    const user = userEvent.setup();
    await screen.findByText('14 periods behind (≈7 lessons)');
    await user.click(screen.getByRole('combobox', { name: 'Class' }));
    await user.click(await screen.findByRole('option', { name: 'Class 7' }));
    await waitFor(() => expect(router.state.location.search).toMatchObject({ plan_class: 'c1' }));
    await waitFor(() => expect(seen.some((s) => s.includes('class_id=c1'))).toBe(true));
    expect(seen.some((s) => s.includes('academic_term_id=t1'))).toBe(true);

    await user.click(screen.getByRole('checkbox', { name: 'Behind only' }));
    await waitFor(() => expect(seen.some((s) => s.includes('behind=true'))).toBe(true));
    expect(router.state.location.search).toMatchObject({ behind: 'true' });
  });

  it('picking Whole year with a current term sends no academic_term_id', async () => {
    handlers([row('p1')]);
    const { router } = render();
    const user = userEvent.setup();
    await screen.findByText('14 periods behind (≈7 lessons)');
    expect(seen.some((s) => s.includes('academic_term_id=t1'))).toBe(true);
    seen.length = 0;
    await user.click(screen.getByRole('combobox', { name: 'Term' }));
    await user.click(await screen.findByRole('option', { name: 'Whole year' }));
    await waitFor(() =>
      expect(router.state.location.search).toMatchObject({ plan_term: 'whole-year' }),
    );
    // The term-less query may already be cached, so only assert nothing term-scoped is sent.
    await new Promise((r) => setTimeout(r, 100));
    expect(seen.every((s) => !s.includes('academic_term_id'))).toBe(true);
    expect(screen.getByRole('combobox', { name: 'Term' }).textContent).toContain('Whole year');
  });

  it('a year with no terms offers "Whole year" and sends no academic_term_id', async () => {
    handlers([row('p1', { term: null })], { terms: [] });
    render();
    await screen.findByText('14 periods behind (≈7 lessons)');
    expect(seen.length).toBeGreaterThan(0);
    expect(seen.every((s) => !s.includes('academic_term_id'))).toBe(true);
    expect(screen.getAllByText('Whole year').length).toBeGreaterThan(0);
  });

  it('view links to the plan and names the row; delete asks first and calls the hook', async () => {
    const deleted: string[] = [];
    handlers([row('p1')], { deleted });
    render();
    const user = userEvent.setup();
    const view = await screen
      .findByRole('link', { name: 'Open ৭ম খ Mathematics' })
      .catch(() => screen.findByRole('link', { name: /^Open .*Mathematics$/ }));
    expect(view.getAttribute('href')).toBe('/academics/study-plans/p1');

    await user.click(screen.getByRole('button', { name: 'Delete plan' }));
    const dialog = await screen.findByRole('alertdialog').catch(() => screen.findByRole('dialog'));
    expect(deleted).toHaveLength(0);
    await user.click(within(dialog).getByRole('button', { name: 'Delete plan' }));
    await waitFor(() => expect(deleted).toEqual(['p1']));
  });

  it('shows no Delete for a role that is not ADMIN / EXECUTIVE', async () => {
    handlers([row('p1')]);
    render('/academics/syllabus?tab=plans', 'en', 'TEACHER');
    await screen.findByText('14 periods behind (≈7 lessons)');
    expect(screen.queryByRole('button', { name: 'Delete plan' })).toBeNull();
  });

  it('empty list shows the EmptyState', async () => {
    handlers([]);
    render();
    expect(await screen.findByText('No study plans yet')).toBeTruthy();
  });

  it('error shows ErrorState and Retry refetches', async () => {
    handlers([], { fail: true });
    render();
    const user = userEvent.setup();
    const retry = await screen.findByRole('button', { name: 'Retry' });
    const before = seen.length;
    await user.click(retry);
    await waitFor(() => expect(seen.length).toBeGreaterThan(before));
  });

  it('Bangla locale renders Bangla digits', async () => {
    handlers([row('p1')]);
    render('/academics/syllabus?tab=plans', 'bn');
    expect(await screen.findAllByText(/১১\/৪০/)).not.toHaveLength(0);
    expect(screen.getByText(/১৪/)).toBeTruthy();
  });
});

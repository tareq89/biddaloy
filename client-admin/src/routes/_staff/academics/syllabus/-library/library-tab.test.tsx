import { REGION_BD_BN } from '@biddaloy/ui/i18n';
import { cleanupTestState, renderWithRouter, server } from '@biddaloy/ui/test';
import { formatNumber } from '@biddaloy/ui/utils';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { afterEach, describe, expect, it } from 'vitest';

import { routeTree } from '../../../../../routeTree.gen';

// Digits render Latin or Bangla depending on the surface, so match either.
const digits = (v: number) => new RegExp(`^(${v}|${formatNumber(v, REGION_BD_BN)})$`);
const CLASS7 = /^Class [7৭]$/;

interface Calls {
  listSearch: string[];
  validateForm: string[];
  committed: unknown[];
  fromPlan: { id: string; body: unknown }[];
  deleted: string[];
  patched: unknown[];
}
let calls: Calls;

const page = (data: unknown[]) => ({ data, total: data.length, page: 1, limit: 25, totalPages: 1 });

function handlers(
  opts: {
    validate?: object;
    deleteFails?: boolean;
    nameTaken?: boolean;
  } = {},
) {
  calls = {
    listSearch: [],
    validateForm: [],
    committed: [],
    fromPlan: [],
    deleted: [],
    patched: [],
  };
  const taken = {
    statusCode: 409,
    message: 'x',
    timestamp: '',
    path: '',
    requestId: 'r',
    details: { code: 'STUDY_PLAN_TEMPLATE_NAME_TAKEN' },
  };
  server.use(
    http.get('/api/v1/classes', () =>
      HttpResponse.json(page([{ id: 'c1', name: 'Class 7', numeric_grade: 7 }])),
    ),
    http.get('/api/v1/subjects', () =>
      HttpResponse.json(
        page([{ id: 'sub1', name_en: 'Mathematics', name_bn: null, code: 'MATH' }]),
      ),
    ),
    http.get('/api/v1/study-plan-templates', ({ request }) => {
      calls.listSearch.push(new URL(request.url).search);
      return HttpResponse.json(
        page([
          {
            id: 'tpl1',
            name: 'National maths 7',
            class_grade: 7,
            subject_code: 'MATH',
            subject_name: 'Mathematics',
            lesson_count: 40,
            total_periods: 52,
            updated_at: '2026-05-12T10:00:00.000Z',
          },
        ]),
      );
    }),
    http.get('/api/v1/study-plan-templates/tpl1', () =>
      HttpResponse.json({ id: 'tpl1', lessons: [{ id: 'l1', title: 'Numbers', periods: 2 }] }),
    ),
    http.get('/api/v1/study-plans', () =>
      HttpResponse.json(
        page([
          {
            id: 'plan9',
            section: { id: 's1', name: 'B', class_id: 'c1', class_name: 'Class 7' },
            subject: { id: 'sub1', name_en: 'Mathematics', name_bn: null, code: 'MATH' },
            term: { id: 't1', name: 'First term' },
            summary: {},
          },
        ]),
      ),
    ),
    http.post('/api/v1/study-plans/import/validate', async ({ request }) => {
      calls.validateForm.push(await request.text());
      return HttpResponse.json(
        opts.validate ?? {
          staging_id: 'stg1',
          expires_at: new Date(Date.now() + 600_000).toISOString(),
          rows_to_create: 40,
          preview: [],
          errors: [],
          warnings: [],
          hard_error_count: 0,
        },
        { status: 201 },
      );
    }),
    http.post('/api/v1/study-plans/import/commit', async ({ request }) => {
      calls.committed.push(await request.json());
      return opts.nameTaken
        ? HttpResponse.json(taken, { status: 409 })
        : HttpResponse.json({ id: 'newtpl', lessons: [] }, { status: 201 });
    }),
    http.post('/api/v1/study-plan-templates/from-plan/:id', async ({ params, request }) => {
      calls.fromPlan.push({ id: String(params.id), body: await request.json() });
      return HttpResponse.json({ id: 'newtpl', lessons: [] }, { status: 201 });
    }),
    http.patch('/api/v1/study-plan-templates/:id', async ({ request }) => {
      calls.patched.push(await request.json());
      return opts.nameTaken
        ? HttpResponse.json(taken, { status: 409 })
        : HttpResponse.json({ id: 'tpl1', lessons: [] });
    }),
    http.delete('/api/v1/study-plan-templates/:id', ({ params }) => {
      calls.deleted.push(String(params.id));
      return opts.deleteFails
        ? HttpResponse.json({ message: 'x' }, { status: 500 })
        : new HttpResponse(null, { status: 204 });
    }),
  );
}

function render(role = 'ADMIN', entry = '/academics/syllabus?tab=library') {
  return renderWithRouter(routeTree, {
    initialEntries: [entry],
    tenantId: 'tenant-1',
    role,
    locale: 'en',
  });
}

afterEach(async () => {
  await cleanupTestState();
});

async function uploadCsv(user: ReturnType<typeof userEvent.setup>) {
  const input = await screen.findByLabelText('CSV file');
  await user.upload(input, new File(['title,periods\nx,2'], 'plan.csv', { type: 'text/csv' }));
}

async function pickScope(user: ReturnType<typeof userEvent.setup>) {
  await user.click(await screen.findByRole('combobox', { name: 'Class' }));
  await user.click(await screen.findByRole('option', { name: CLASS7 }));
  await user.click(screen.getByRole('combobox', { name: 'Subject' }));
  await user.click(await screen.findByRole('option', { name: 'Mathematics' }));
}

describe('Syllabus › Template library', () => {
  it('rows show name, class, subject + code and the totals; a teacher can copy but not change', async () => {
    handlers();
    render('TEACHER');
    expect((await screen.findAllByText('National maths 7')).length).toBeGreaterThan(0);
    expect(screen.getAllByText('Mathematics (MATH)').length).toBeGreaterThan(0);
    expect(screen.getAllByText(digits(40)).length).toBeGreaterThan(0);
    expect(screen.getAllByText(digits(52)).length).toBeGreaterThan(0);
    const buttons = screen.getAllByRole('button').map((b) => b.getAttribute('aria-label') ?? '');
    const copy = buttons.indexOf('Copy to my plan');
    expect(copy).toBeGreaterThanOrEqual(0);
    expect(copy).toBeLessThan(buttons.indexOf('View National maths 7'));
    expect(screen.queryByRole('button', { name: 'Edit National maths 7' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'More actions' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Add template' })).toBeNull();
  });

  it('an ADMIN sees Add template, edit and delete; Copy opens the wizard URL', async () => {
    handlers();
    const { router } = render('ADMIN');
    await screen.findAllByText('National maths 7');
    expect(screen.getByRole('button', { name: 'Add template' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Edit National maths 7' })).toBeTruthy();
    expect(screen.getAllByRole('button', { name: 'More actions' }).length).toBeGreaterThan(0);
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Copy to my plan' }));
    await waitFor(() =>
      expect(router.state.location.search).toMatchObject({ tab: 'plans', template: 'tpl1' }),
    );
  });

  it('a CSV with errors keeps Save disabled; a clean one commits with the template target', async () => {
    handlers({
      validate: {
        staging_id: 'bad',
        expires_at: new Date(Date.now() + 600_000).toISOString(),
        rows_to_create: 0,
        preview: [],
        errors: [{ row: 3, column: 'periods', message: 'Not a number', severity: 'error' }],
        warnings: [],
        hard_error_count: 1,
      },
    });
    render('ADMIN');
    const user = userEvent.setup({ applyAccept: false });
    await user.click(await screen.findByRole('button', { name: 'Add from CSV' }));
    await user.type(await screen.findByLabelText('Template name'), 'My template');
    await pickScope(user);
    await uploadCsv(user);
    expect(await screen.findByText(/Not a number/)).toBeTruthy();
    expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Save' }).disabled).toBe(true);
  });

  it('a clean CSV commits with { template } and no class_id', async () => {
    handlers();
    render('EXECUTIVE');
    const user = userEvent.setup({ applyAccept: false });
    await user.click(await screen.findByRole('button', { name: 'Add from CSV' }));
    await user.type(await screen.findByLabelText('Template name'), 'My template');
    await pickScope(user);
    await uploadCsv(user);
    await waitFor(() => expect(calls.validateForm).toHaveLength(1));
    const form = calls.validateForm[0] as string;
    expect(form).toMatch(/name="class_grade"\r?\n\r?\n7/);
    expect(form).toMatch(/name="subject_code"\r?\n\r?\nMATH/);
    expect(form).not.toContain('class_id');
    await waitFor(() =>
      expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Save' }).disabled).toBe(false),
    );
    await user.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(calls.committed).toHaveLength(1));
    expect(calls.committed[0]).toEqual({
      staging_id: 'stg1',
      template: { name: 'My template', class_grade: 7, subject_code: 'MATH' },
    });
  });

  it('From a study plan posts from-plan/<planId> with { name }', async () => {
    handlers();
    render('EXECUTIVE');
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Add template' }));
    await user.type(await screen.findByLabelText('Template name'), 'From a plan');
    await user.click(await screen.findByRole('combobox', { name: 'Study plan' }));
    await user.click(await screen.findByRole('option', { name: /Class 7-B/ }));
    await user.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(calls.fromPlan).toHaveLength(1));
    expect(calls.fromPlan[0]).toEqual({ id: 'plan9', body: { name: 'From a plan' } });
  });

  it('rename with a taken name shows the field error', async () => {
    handlers({ nameTaken: true });
    render('ADMIN');
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Edit National maths 7' }));
    await user.click(await screen.findByRole('button', { name: 'Save' }));
    expect(await screen.findByText('A template with this name already exists.')).toBeTruthy();
  });

  it('delete asks first; a failure shows the page-level sentence', async () => {
    handlers({ deleteFails: true });
    render('ADMIN');
    const user = userEvent.setup();
    await screen.findAllByText('National maths 7');
    await user.click(
      within(screen.getAllByRole('row')[1] as HTMLElement).getByRole('button', {
        name: 'More actions',
      }),
    );
    await user.click(await screen.findByText('Delete National maths 7'));
    expect(calls.deleted).toHaveLength(0);
    expect(await screen.findByText(/Plans already copied from it keep their lessons/)).toBeTruthy();
    await user.click(
      screen.getAllByRole('button', { name: 'Delete National maths 7' }).at(-1) as HTMLElement,
    );
    await waitFor(() => expect(calls.deleted).toEqual(['tpl1']));
    expect(await screen.findByText("Couldn't delete the template.")).toBeTruthy();
  });

  it('Class and Subject filters write tpl_* to the URL and reach the API', async () => {
    handlers();
    const { router } = render('ADMIN');
    const user = userEvent.setup();
    await screen.findAllByText('National maths 7');
    await user.click(screen.getByRole('combobox', { name: 'Class' }));
    await user.click(await screen.findByRole('option', { name: CLASS7 }));
    await user.click(screen.getByRole('combobox', { name: 'Subject' }));
    await user.click(await screen.findByRole('option', { name: 'Mathematics' }));
    await waitFor(() =>
      expect(router.state.location.search).toMatchObject({ tpl_grade: '7', tpl_subject: 'MATH' }),
    );
    await waitFor(() =>
      expect(
        calls.listSearch.some(
          (s) => s.includes('class_grade=7') && s.includes('subject_code=MATH'),
        ),
      ).toBe(true),
    );
  });
});

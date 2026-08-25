/**
 * [8.11.6]'s full "generate a month's fees" loop — real route tree and a
 * real `WizardShell`, same reasoning `payments/record.test.tsx` gives for
 * itself.
 *
 * The academic year used throughout runs **April 2026 → March 2027** on
 * purpose: it straddles two calendar years, so "this month is outside the
 * academic year" is reachable (January 2026) without inventing a second
 * fixture, and the year `Select` has more than one option to be wrong
 * about.
 */
import {
  academicYearFactory,
  classFactory,
  cleanupTestState,
  feeHandlers,
  renderWithRouter,
  server,
  type AcademicYear,
} from '@biddaloy/ui/test';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { afterEach, describe, expect, it } from 'vitest';

import { routeTree } from '../../../routeTree.gen';

const YEAR: AcademicYear = academicYearFactory({
  id: 'year-1',
  name: '2026-2027',
  start_date: '2026-04-01T00:00:00.000Z',
  end_date: '2027-03-31T00:00:00.000Z',
  is_current: true,
});

const KLASS = classFactory({ id: 'class-9', name: 'Class 9', academic_year: YEAR });

/** A second, earlier academic year with a class list of its own. Classes
 * belong to exactly one year, so switching between these two is what
 * makes a stale `class_id` reachable. */
const PRIOR_YEAR: AcademicYear = academicYearFactory({
  id: 'year-0',
  name: '2025-2026',
  start_date: '2025-04-01T00:00:00.000Z',
  end_date: '2026-03-31T00:00:00.000Z',
  is_current: false,
});

const PRIOR_KLASS = classFactory({
  id: 'class-8',
  name: 'Class 8',
  academic_year: PRIOR_YEAR,
});

const SECTION = {
  id: 'section-a',
  class: KLASS,
  class_id: KLASS.id,
  section_name: 'A',
  capacity: 40,
  tenant: YEAR.tenant,
  tenant_id: YEAR.tenant_id,
  enrolled_count: 12,
  created_at: YEAR.created_at,
  updated_at: YEAR.updated_at,
  deleted_at: null,
};

/** Everything the wizard reads before it ever posts: the year list, the
 * class list, that class's sections, and the student count the review
 * step quotes. */
function referenceHandlers(studentTotal = 37) {
  return [
    http.get('/api/v1/academic-years', () =>
      HttpResponse.json({ data: [YEAR], total: 1, page: 1, limit: 10, totalPages: 1 }),
    ),
    http.get('/api/v1/classes', () =>
      HttpResponse.json({ data: [KLASS], total: 1, page: 1, limit: 100, totalPages: 1 }),
    ),
    http.get('/api/v1/classes/:classId/sections', () => HttpResponse.json([SECTION])),
    http.get('/api/v1/students', () =>
      HttpResponse.json({ data: [], total: studentTotal, page: 1, limit: 1, totalPages: 37 }),
    ),
  ];
}

function render(role = 'ADMIN') {
  return renderWithRouter(routeTree, {
    initialEntries: ['/fees/generate'],
    tenantId: 'tenant-1',
    role,
    locale: 'en',
  });
}

/** Year → Scope → Period, leaving every default in place (the current
 * academic year, all classes, all sections, and the academic year's own
 * first month), which lands on the review step. */
async function walkToReview(user: ReturnType<typeof userEvent.setup>) {
  await screen.findByRole('combobox', { name: 'Academic year' });
  await user.click(screen.getByRole('button', { name: 'Next' }));
  await screen.findByRole('combobox', { name: 'Class' });
  await user.click(screen.getByRole('button', { name: 'Next' }));
  await screen.findByRole('combobox', { name: 'Month' });
  await user.click(screen.getByRole('button', { name: 'Next' }));
  await screen.findByText('Check this before generating');
}

describe('/fees/generate', () => {
  afterEach(async () => {
    await cleanupTestState();
  });

  it('generates a month of fees and reports all three counts in plain language', async () => {
    let body: Record<string, unknown> | undefined;
    server.use(
      ...referenceHandlers(),
      http.post('/api/v1/fees/generate', async ({ request }) => {
        body = (await request.json()) as Record<string, unknown>;
        return HttpResponse.json(
          { generated: 34, skipped: 3, students_evaluated: 37 },
          { status: 201 },
        );
      }),
    );

    const user = userEvent.setup();
    render();
    await walkToReview(user);

    await user.click(screen.getByRole('button', { name: 'Generate fees' }));

    const result = await screen.findByRole('status');
    expect(within(result).getByText('34 fee records created')).toBeTruthy();
    expect(within(result).getByText('3 skipped')).toBeTruthy();
    expect(within(result).getByText('37 students evaluated')).toBeTruthy();
    // The sentence this whole screen exists for — without it, "skipped"
    // generates support questions forever.
    expect(
      within(result).getByText(
        /Skipped means a fee record already exists for that student and month/,
      ),
    ).toBeTruthy();

    // The academic year defaults to `is_current`, and "all classes"/"all
    // sections" send no scope keys at all rather than a sentinel.
    expect(body).toEqual({ academic_year_id: 'year-1', month: 4, year: 2026 });
  });

  it('shows the scope and the expected student count before anything is posted', async () => {
    let posts = 0;
    server.use(
      ...referenceHandlers(37),
      http.post('/api/v1/fees/generate', () => {
        posts += 1;
        return HttpResponse.json(
          { generated: 0, skipped: 0, students_evaluated: 0 },
          { status: 201 },
        );
      }),
    );

    const user = userEvent.setup();
    render();

    // Narrow the scope so the review step has something specific to say.
    await screen.findByRole('combobox', { name: 'Academic year' });
    await user.click(screen.getByRole('button', { name: 'Next' }));
    await user.click(await screen.findByRole('combobox', { name: 'Class' }));
    await user.click(await screen.findByRole('option', { name: 'Class 9' }));
    await user.click(await screen.findByRole('combobox', { name: 'Section' }));
    await user.click(await screen.findByRole('option', { name: 'A' }));
    await user.click(screen.getByRole('button', { name: 'Next' }));
    await screen.findByRole('combobox', { name: 'Month' });
    await user.click(screen.getByRole('button', { name: 'Next' }));

    await screen.findByText('Check this before generating');
    // Read back as `<dd>`s — `getAllByText` and a tag-name check, because
    // the earlier steps stay mounted (hidden) with the same values still
    // showing in their own `Select` triggers.
    expect(screen.getAllByText('2026-2027').some((node) => node.tagName === 'DD')).toBe(true);
    expect(screen.getAllByText('Class 9').some((node) => node.tagName === 'DD')).toBe(true);
    expect(screen.getAllByText('A').some((node) => node.tagName === 'DD')).toBe(true);
    expect(screen.getByText('April 2026')).toBeTruthy();
    expect(
      await screen.findByText('37 active students are in scope and will be evaluated.'),
    ).toBeTruthy();
    // The count promises students *looked at*, never fee records written.
    expect(
      screen.getByText(/That is how many students will be looked at, not how many fee records/),
    ).toBeTruthy();

    // Nothing has been written — the review step is a preview, not a
    // side effect.
    expect(posts).toBe(0);
  });

  it('disables the submit button while the batch is in flight and announces completion', async () => {
    // A gate rather than a fixed `delay(n)`: the assertions below are
    // about *observing* the pending state, and any fixed delay can be
    // outrun by `user.click`'s own async flushing under a loaded run.
    // Same reasoning `payments/record.test.tsx` documents for itself.
    let releaseGenerate!: () => void;
    const gate = new Promise<void>((resolve) => {
      releaseGenerate = resolve;
    });
    server.use(
      ...referenceHandlers(),
      http.post('/api/v1/fees/generate', async () => {
        await gate;
        return HttpResponse.json(
          { generated: 5, skipped: 0, students_evaluated: 5 },
          { status: 201 },
        );
      }),
    );

    const user = userEvent.setup();
    render();
    await walkToReview(user);

    const submit = screen.getByRole<HTMLButtonElement>('button', { name: 'Generate fees' });
    await user.click(submit);

    await waitFor(() => expect(submit.disabled).toBe(true));
    expect(submit.getAttribute('aria-busy')).toBe('true');
    // Nothing optimistic: no result on screen until the server answers.
    expect(screen.queryByRole('status')).toBeNull();

    releaseGenerate();
    await waitFor(() => expect(screen.getByRole('status')).toBeTruthy());
    expect(screen.getByText('5 fee records created')).toBeTruthy();
  });

  it('treats an all-skipped re-run as success, not an error', async () => {
    server.use(...referenceHandlers(), feeHandlers.generateAllSkipped);

    const user = userEvent.setup();
    render();
    await walkToReview(user);
    await user.click(screen.getByRole('button', { name: 'Generate fees' }));

    const result = await screen.findByRole('status');
    expect(within(result).getByText('42 skipped')).toBeTruthy();
    expect(
      within(result).getByText(
        'Nothing new was created this time. Everything in scope already had a fee record for this month.',
      ),
    ).toBeTruthy();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('keeps the entered scope after a failed run, so nothing has to be re-chosen', async () => {
    server.use(
      ...referenceHandlers(),
      http.post('/api/v1/fees/generate', () =>
        HttpResponse.json(
          {
            statusCode: 400,
            message: 'Month 4/2026 is outside academic year "2026-2027" (2026-04-01 → 2027-03-31)',
            timestamp: new Date().toISOString(),
            path: '/api/v1/fees/generate',
            requestId: crypto.randomUUID(),
          },
          { status: 400 },
        ),
      ),
    );

    const user = userEvent.setup();
    render();

    await screen.findByRole('combobox', { name: 'Academic year' });
    await user.click(screen.getByRole('button', { name: 'Next' }));
    await user.click(await screen.findByRole('combobox', { name: 'Class' }));
    await user.click(await screen.findByRole('option', { name: 'Class 9' }));
    await user.click(screen.getByRole('button', { name: 'Next' }));
    await screen.findByRole('combobox', { name: 'Month' });
    await user.click(screen.getByRole('button', { name: 'Next' }));
    await screen.findByText('Check this before generating');
    await user.click(screen.getByRole('button', { name: 'Generate fees' }));

    // The server's own message, not a generic "something went wrong".
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('is outside academic year');
    expect(screen.queryByRole('status')).toBeNull();

    // Back through the wizard: every choice is still there.
    await user.click(screen.getByRole('button', { name: 'Back' }));
    expect(screen.getByRole('combobox', { name: 'Month' }).textContent).toContain('April');
    await user.click(screen.getByRole('button', { name: 'Back' }));
    expect(screen.getByRole('combobox', { name: 'Class' }).textContent).toContain('Class 9');
  });

  it('maps a 429 to the rate-limit explanation rather than the raw error', async () => {
    server.use(
      ...referenceHandlers(),
      // What the stock `@nestjs/throttler` guard actually produces once
      // the app's error filter has shaped it — an `ApiError` whose
      // message ("ThrottlerException: Too Many Requests") is useless to
      // an accountant, which is the whole reason this branch exists.
      http.post('/api/v1/fees/generate', () =>
        HttpResponse.json(
          {
            statusCode: 429,
            message: 'ThrottlerException: Too Many Requests',
            timestamp: new Date().toISOString(),
            path: '/api/v1/fees/generate',
            requestId: crypto.randomUUID(),
          },
          { status: 429, headers: { 'Retry-After': '30' } },
        ),
      ),
    );

    const user = userEvent.setup();
    render();
    await walkToReview(user);
    await user.click(screen.getByRole('button', { name: 'Generate fees' }));

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('limited to 5 runs per minute');
  });

  it('blocks a month outside the academic year before the server is ever asked', async () => {
    let posts = 0;
    server.use(
      ...referenceHandlers(),
      http.post('/api/v1/fees/generate', () => {
        posts += 1;
        return HttpResponse.json(
          { generated: 0, skipped: 0, students_evaluated: 0 },
          { status: 201 },
        );
      }),
    );

    const user = userEvent.setup();
    render();

    await screen.findByRole('combobox', { name: 'Academic year' });
    await user.click(screen.getByRole('button', { name: 'Next' }));
    await screen.findByRole('combobox', { name: 'Class' });
    await user.click(screen.getByRole('button', { name: 'Next' }));

    // January 2026 is before the 2026-2027 year starts in April 2026 —
    // exactly the 400 `fee-generation.service.ts` would answer with.
    await user.click(await screen.findByRole('combobox', { name: 'Month' }));
    await user.click(await screen.findByRole('option', { name: 'January' }));

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('is outside 2026-2027');
    expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Next' }).disabled).toBe(true);
    expect(posts).toBe(0);
  });

  it('is completable with the keyboard alone', async () => {
    server.use(
      ...referenceHandlers(),
      http.post('/api/v1/fees/generate', () =>
        HttpResponse.json({ generated: 7, skipped: 1, students_evaluated: 8 }, { status: 201 }),
      ),
    );

    const user = userEvent.setup();
    render();
    await screen.findByRole('combobox', { name: 'Academic year' });

    // Tab reaches the year picker without a single click — the first
    // stop is `AppShell`'s skip link, which is exactly what it's there
    // for, so this walks forward until it lands on the wizard.
    const yearPicker = screen.getByRole('combobox', { name: 'Academic year' });
    for (let i = 0; i < 60 && document.activeElement !== yearPicker; i += 1) {
      await user.tab();
    }
    expect(document.activeElement).toBe(yearPicker);

    // Every step's default is already valid, so Enter on "Next" walks the
    // whole wizard and Enter on the submit button runs it.
    for (let step = 0; step < 3; step += 1) {
      screen.getByRole('button', { name: 'Next' }).focus();
      await user.keyboard('{Enter}');
    }

    await screen.findByText('Check this before generating');
    screen.getByRole('button', { name: 'Generate fees' }).focus();
    await user.keyboard('{Enter}');

    expect(await screen.findByRole('status')).toBeTruthy();
  });

  it('shows the forbidden message to a role that cannot generate fees', async () => {
    server.use(...referenceHandlers());

    render('TEACHER');

    expect(await screen.findByText("You don't have permission to view this.")).toBeTruthy();
    expect(screen.queryByRole('combobox', { name: 'Academic year' })).toBeNull();
  });

  // A class belongs to one academic year. Changing the year after a class
  // has been chosen used to leave the old `class_id` in state: the review
  // panel read "All classes" (that id was gone from the refetched list)
  // while the request still carried it, so the server evaluated last
  // year's class against this year's fee structures and generated nothing.
  it('clears the chosen class when the academic year changes', async () => {
    let body: Record<string, unknown> | undefined;
    server.use(
      http.get('/api/v1/academic-years', () =>
        HttpResponse.json({
          data: [YEAR, PRIOR_YEAR],
          total: 2,
          page: 1,
          limit: 10,
          totalPages: 1,
        }),
      ),
      // The class list is year-scoped, exactly as the real endpoint is.
      http.get('/api/v1/classes', ({ request }) => {
        const yearId = new URL(request.url).searchParams.get('academic_year_id');
        const data = yearId === PRIOR_YEAR.id ? [PRIOR_KLASS] : [KLASS];
        return HttpResponse.json({ data, total: 1, page: 1, limit: 100, totalPages: 1 });
      }),
      http.get('/api/v1/classes/:classId/sections', () => HttpResponse.json([SECTION])),
      http.get('/api/v1/students', () =>
        HttpResponse.json({ data: [], total: 12, page: 1, limit: 1, totalPages: 12 }),
      ),
      http.post('/api/v1/fees/generate', async ({ request }) => {
        body = (await request.json()) as Record<string, unknown>;
        return HttpResponse.json(
          { generated: 1, skipped: 0, students_evaluated: 1 },
          { status: 201 },
        );
      }),
    );

    const user = userEvent.setup();
    render();

    await screen.findByRole('combobox', { name: 'Academic year' });
    await user.click(screen.getByRole('button', { name: 'Next' }));
    await user.click(await screen.findByRole('combobox', { name: 'Class' }));
    await user.click(await screen.findByRole('option', { name: 'Class 9' }));

    // Back to step 1 and switch to the year that has no Class 9.
    await user.click(screen.getByRole('button', { name: 'Back' }));
    await user.click(await screen.findByRole('combobox', { name: 'Academic year' }));
    await user.click(await screen.findByRole('option', { name: '2025-2026' }));
    await user.click(screen.getByRole('button', { name: 'Next' }));

    // The scope reverted to "All classes" rather than silently keeping an
    // id that belongs to the other year.
    await waitFor(() =>
      expect(
        within(screen.getByRole('combobox', { name: 'Class' })).getByText('All classes'),
      ).toBeTruthy(),
    );

    await user.click(screen.getByRole('button', { name: 'Next' }));
    await screen.findByRole('combobox', { name: 'Month' });
    await user.click(screen.getByRole('button', { name: 'Next' }));
    await screen.findByText('Check this before generating');
    await user.click(screen.getByRole('button', { name: 'Generate fees' }));

    await waitFor(() => expect(body).toBeDefined());
    // What the review panel promised is what was sent: no class scope.
    expect(body).not.toHaveProperty('class_id');
    expect(body?.academic_year_id).toBe(PRIOR_YEAR.id);
  });

  // Deep-linking to the review step mounts only that panel, skipping every
  // earlier step's validity gate. Submitting before the academic years
  // land would be a silent no-op, so the button has to stay disabled.
  it('disables the submit button on a deep link until the year list resolves', async () => {
    server.use(
      http.get('/api/v1/academic-years', () =>
        HttpResponse.json({ data: [], total: 0, page: 1, limit: 10, totalPages: 1 }),
      ),
      ...referenceHandlers().slice(1),
    );

    renderWithRouter(routeTree, {
      initialEntries: ['/fees/generate?step=review'],
      tenantId: 'tenant-1',
      role: 'ADMIN',
      locale: 'en',
    });

    const submit = await screen.findByRole('button', { name: 'Generate fees' });
    expect(submit.hasAttribute('disabled')).toBe(true);
  });

  // The failure alert names a month and a scope. Leaving it up after the
  // accountant has changed either one reports a rejection that no longer
  // describes what they are about to send.
  it('drops a stale failure alert once the period is changed', async () => {
    server.use(
      ...referenceHandlers(),
      http.post('/api/v1/fees/generate', () =>
        HttpResponse.json(
          {
            statusCode: 500,
            message: 'Fee generation failed',
            timestamp: new Date().toISOString(),
            path: '/api/v1/fees/generate',
            requestId: crypto.randomUUID(),
          },
          { status: 500 },
        ),
      ),
    );

    const user = userEvent.setup();
    render();
    await walkToReview(user);
    await user.click(screen.getByRole('button', { name: 'Generate fees' }));
    expect(await screen.findByRole('alert')).toBeTruthy();

    await user.click(screen.getByRole('button', { name: 'Back' }));
    await user.click(await screen.findByRole('combobox', { name: 'Month' }));
    await user.click(await screen.findByRole('option', { name: 'May' }));
    await user.click(screen.getByRole('button', { name: 'Next' }));
    await screen.findByText('Check this before generating');

    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('is axe clean', async () => {
    server.use(...referenceHandlers());

    const user = userEvent.setup();
    const { container } = render();
    await walkToReview(user);
    // Waits for the real review content, not just the shell — an empty
    // step would pass trivially.
    await screen.findByText('37 active students are in scope and will be evaluated.');

    await expect(container).toHaveNoViolations();
  });
});

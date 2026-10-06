import { REGION_BD_EN } from '@biddaloy/ui/i18n';
import { cleanupTestState, renderWithRouter, server, userEvent } from '@biddaloy/ui/test';
import { act, screen, waitFor, within } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { afterEach, describe, expect, it } from 'vitest';

import { routeTree } from '../../../routeTree.gen';

// `register.tsx`'s search schema validates these with `z.string().uuid()`,
// which (unlike `reports.tsx`, whose filters bag isn't schema-validated)
// enforces the real RFC 4122 variant nibble — a same-digit placeholder
// like `1111...` silently fails that check and gets dropped by `.catch()`.
const CLASS_ID = '11111111-1111-4111-8111-111111111111';
const SECTION_ID = '22222222-2222-4222-8222-222222222222';

function dates31(month: string) {
  return Array.from({ length: 31 }, (_, i) => ({
    date: `${month}-${String(i + 1).padStart(2, '0')}`,
    is_working_day: true,
  }));
}

function registerRow(overrides: Record<string, unknown> = {}) {
  return {
    student_id: 'student-1',
    roll_number: 4,
    full_name: 'Karim Rahman',
    marks: { '2026-01-01': 'PRESENT', '2026-01-02': 'ABSENT' },
    summary: {
      student_id: 'student-1',
      from: '2026-01-01',
      to: '2026-01-31',
      working_days: 26,
      marked_days: 20,
      present_days: 18,
      late_days: 1,
      absent_days: 1,
      leave_days: 0,
      unmarked_days: 6,
      attendance_percentage: 90,
      policy: {
        late_counts_as_present: true,
        leave_counts_as_working_day: true,
        denominator: 'WORKING_DAYS',
      },
    },
    ...overrides,
  };
}

// The default test tenant settings say Bangla digits and month names; the tests that read
// formatted numbers/months pin the English region so locale and region agree.
const pinEnglishRegion = http.get('/api/v1/schools/:schoolId/settings', () =>
  HttpResponse.json({ version: 1, region: REGION_BD_EN }),
);

describe('/attendance/register', () => {
  afterEach(async () => {
    await cleanupTestState();
  });

  it('prompts for a section instead of fetching anything when none is selected', async () => {
    renderWithRouter(routeTree, {
      initialEntries: ['/attendance/register'],
      tenantId: 'tenant-1',
      role: 'ADMIN',
      locale: 'en',
    });

    await waitFor(() =>
      expect(
        screen.getByText('Pick a class, section and month to generate the register.'),
      ).toBeTruthy(),
    );
    expect(screen.getByRole('heading', { name: 'No section picked yet' })).toBeTruthy();
    // Kit selects and month picker, each with a visible label — no native controls.
    expect(screen.getByLabelText('Class')).toBeTruthy();
    expect(screen.getByLabelText('Section')).toBeTruthy();
    expect(screen.getByLabelText('Month')).toBeTruthy();
    expect(document.querySelector('select, input[type="month"]')).toBeNull();
    // Nothing to print yet.
    expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Print' }).disabled).toBe(true);
  });

  it('renders 31 day columns plus totals, each cell carrying an sr-only status word, for a 31-day month', async () => {
    server.use(
      pinEnglishRegion,
      http.get('/api/v1/attendance/sections/:sectionId/register-matrix', () =>
        HttpResponse.json({ dates: dates31('2026-01'), rows: [registerRow()] }),
      ),
    );

    const { localeReady } = renderWithRouter(routeTree, {
      initialEntries: [
        `/attendance/register?class_id=${CLASS_ID}&section_id=${SECTION_ID}&month=2026-01`,
      ],
      tenantId: 'tenant-1',
      role: 'ADMIN',
      locale: 'en',
    });
    await localeReady;

    const table = await screen.findByRole('table');
    // 31 day columns + Roll + Student + 5 total columns = 38 header cells.
    expect(within(table).getAllByRole('columnheader')).toHaveLength(38);

    // Not just the visible "P"/"A" abbreviation — an accessible full word
    // per day cell too. `getAllByText` (not `getByText`) since "Present"/
    // "Absent" also legitimately appear once as this table's own
    // "Present"/"Absent" total-column headers.
    expect(within(table).getAllByText('Present').length).toBeGreaterThan(1);
    expect(within(table).getAllByText('Absent').length).toBeGreaterThan(1);
    // Letters come from i18n and are explained by a legend; Print is on once rows load.
    expect(within(table).getAllByText('P').length).toBeGreaterThan(0);
    expect(within(table).getAllByText('A').length).toBeGreaterThan(0);
    expect(screen.getByText('P = Present')).toBeTruthy();
    expect(screen.getByText('— = school closed')).toBeTruthy();
    expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Print' }).disabled).toBe(false);
    expect(await screen.findByText('Total 1')).toBeTruthy();
  });

  it('shows an unrecognized status as "?" / "Unknown", never the raw enum', async () => {
    server.use(
      http.get('/api/v1/attendance/sections/:sectionId/register-matrix', () =>
        HttpResponse.json({
          dates: [{ date: '2026-01-01', is_working_day: true }],
          // A status this client doesn't know about yet — the DTO cast
          // in register.tsx is a type assertion, not a validation, so the
          // server can send anything.
          rows: [registerRow({ marks: { '2026-01-01': 'HALF_DAY' } })],
        }),
      ),
    );

    renderWithRouter(routeTree, {
      initialEntries: [
        `/attendance/register?class_id=${CLASS_ID}&section_id=${SECTION_ID}&month=2026-01`,
      ],
      tenantId: 'tenant-1',
      role: 'ADMIN',
      locale: 'en',
    });

    await screen.findByRole('table');
    expect(screen.getByText('?')).toBeTruthy();
    expect(screen.getByText('Unknown')).toBeTruthy();
    expect(screen.queryByText('HALF_DAY')).toBeNull();
  });

  it('names class, section and month in the table caption', async () => {
    server.use(
      pinEnglishRegion,
      http.get('/api/v1/classes', () =>
        HttpResponse.json({
          data: [{ id: CLASS_ID, name: 'Class 5', section_count: 1, student_count: 30 }],
          total: 1,
          page: 1,
          limit: 20,
          totalPages: 1,
        }),
      ),
      http.get('/api/v1/classes/:classId/sections', () =>
        HttpResponse.json([{ id: SECTION_ID, section_name: 'A', enrolled_count: 30 }]),
      ),
      http.get('/api/v1/attendance/sections/:sectionId/register-matrix', () =>
        HttpResponse.json({ dates: dates31('2026-01'), rows: [registerRow()] }),
      ),
    );

    const { localeReady } = renderWithRouter(routeTree, {
      initialEntries: [
        `/attendance/register?class_id=${CLASS_ID}&section_id=${SECTION_ID}&month=2026-01`,
      ],
      tenantId: 'tenant-1',
      role: 'ADMIN',
      locale: 'en',
    });
    await localeReady;

    await waitFor(() =>
      expect(screen.getByText('Attendance register — Class 5 – A, January 2026')).toBeTruthy(),
    );
    expect(await screen.findByRole('heading', { name: 'Class 5 – A · January 2026' })).toBeTruthy();
  });

  it('shows an empty state when the section has no students', async () => {
    server.use(
      http.get('/api/v1/attendance/sections/:sectionId/register-matrix', () =>
        HttpResponse.json({ dates: dates31('2026-01'), rows: [] }),
      ),
    );

    renderWithRouter(routeTree, {
      initialEntries: [
        `/attendance/register?class_id=${CLASS_ID}&section_id=${SECTION_ID}&month=2026-01`,
      ],
      tenantId: 'tenant-1',
      role: 'ADMIN',
      locale: 'en',
    });

    await waitFor(() => expect(screen.getByText('No students in this section.')).toBeTruthy());
    expect(screen.getByText('The register appears once students are enrolled.')).toBeTruthy();
    // A retry cannot change an empty section — no fake action.
    expect(screen.queryByRole('button', { name: 'Retry' })).toBeNull();
  });

  it('shows an error state when the register-matrix request fails', async () => {
    server.use(
      http.get('/api/v1/attendance/sections/:sectionId/register-matrix', () =>
        HttpResponse.json({ message: 'boom' }, { status: 500 }),
      ),
    );

    renderWithRouter(routeTree, {
      initialEntries: [
        `/attendance/register?class_id=${CLASS_ID}&section_id=${SECTION_ID}&month=2026-01`,
      ],
      tenantId: 'tenant-1',
      role: 'ADMIN',
      locale: 'en',
    });

    await waitFor(() => expect(screen.getByText('Could not load the register.')).toBeTruthy());
    expect(screen.getByRole('button', { name: 'Retry' })).toBeTruthy();
  });

  it('falls back to the locale default region for a user without SETTINGS_MANAGE', async () => {
    let settingsRequested = false;
    server.use(
      http.get('/api/v1/schools/:schoolId/settings', () => {
        settingsRequested = true;
        return HttpResponse.json({ version: 1, region: { ...REGION_BD_EN, numerals: 'bengali' } });
      }),
      http.get('/api/v1/attendance/sections/:sectionId/register-matrix', () =>
        HttpResponse.json({ dates: dates31('2026-01'), rows: [registerRow()] }),
      ),
    );

    const { localeReady } = renderWithRouter(routeTree, {
      initialEntries: [
        `/attendance/register?class_id=${CLASS_ID}&section_id=${SECTION_ID}&month=2026-01`,
      ],
      tenantId: 'tenant-1',
      role: 'TEACHER',
      locale: 'en',
    });
    await localeReady;

    // The school settings are never read for a teacher, so the tenant's Bengali digits
    // never apply: the totals footer uses the locale-default (English) region.
    expect(await screen.findByText('Total 1')).toBeTruthy();
    expect(settingsRequested).toBe(false);
  });
});

// [41.4.3] Month edit. jsdom's matchMedia stub reports "no match" (phone) by
// default; a test flips the cached `md` query to simulate a desktop.
const MD_QUERY = '(min-width: 768px)';
function setDesktop(on: boolean) {
  (window.matchMedia(MD_QUERY) as { matches: boolean }).matches = on;
}

const EDIT_URL = `/attendance/register?class_id=${CLASS_ID}&section_id=${SECTION_ID}&month=2026-01`;

function useMatrix(putHandler?: Parameters<typeof http.put>[1]) {
  server.use(
    pinEnglishRegion,
    http.get('/api/v1/attendance/sections/:sectionId/register-matrix', () =>
      HttpResponse.json({
        dates: dates31('2026-01'),
        versions: { '2026-01-01': 3 },
        rows: [
          registerRow(),
          registerRow({
            student_id: 'student-2',
            roll_number: 5,
            full_name: 'Rina Akter',
            marks: { '2026-01-01': 'PRESENT' },
          }),
        ],
      }),
    ),
    ...(putHandler
      ? [http.put('/api/v1/attendance/sections/:sectionId/register-matrix', putHandler)]
      : []),
  );
}

async function openEditor(role = 'ADMIN', url = EDIT_URL) {
  const { localeReady } = renderWithRouter(routeTree, {
    initialEntries: [url],
    tenantId: 'tenant-1',
    role,
    locale: 'en',
  });
  await localeReady;
}

describe('/attendance/register month edit', () => {
  afterEach(async () => {
    setDesktop(false);
    await cleanupTestState();
  });

  it('hides Edit without ATTENDANCE_MARK', async () => {
    setDesktop(true);
    useMatrix();
    await openEditor('ACCOUNTANT');
    await screen.findByRole('table');
    expect(screen.queryByRole('button', { name: 'Edit' })).toBeNull();
  });

  it('saves one item per changed date with every marked student', async () => {
    setDesktop(true);
    let body: Record<string, unknown> | undefined;
    useMatrix(async ({ request }) => {
      body = (await request.json()) as Record<string, unknown>;
      return HttpResponse.json({ saved_dates: ['2026-01-01', '2026-01-03'], versions: {} });
    });
    const user = userEvent.setup();
    await openEditor();
    await user.click(await screen.findByRole('button', { name: 'Edit' }));

    const grid = await screen.findByRole('grid');
    // Jan 1: Karim PRESENT -> ABSENT. Jan 3: nobody marked yet -> Karim LATE.
    within(grid)
      .getByRole('gridcell', { name: /Karim Rahman, .*: Present/ })
      .focus();
    await user.keyboard('a');
    within(grid)
      .getAllByRole('gridcell', { name: /Karim Rahman, .*: Not marked/ })[0]!
      .focus();
    await user.keyboard('l');
    expect(await screen.findByText('2 cells changed')).toBeTruthy();
    expect(screen.getByText(/will be created/)).toBeTruthy();

    // All of January is past the 2-day window, so a reason is needed.
    await user.type(screen.getByLabelText(/Reason for correction/), 'Copied from paper register');
    await user.click(screen.getByRole('button', { name: 'Save (2)' }));

    await waitFor(() => expect(body).toBeTruthy());
    const days = body!.days as { date: string; base_version: number | null; entries: unknown[] }[];
    expect(days.map((d) => d.date)).toEqual(['2026-01-01', '2026-01-03']);
    expect(days[0]).toMatchObject({
      base_version: 3,
      entries: [
        { student_id: 'student-1', status: 'ABSENT' },
        { student_id: 'student-2', status: 'PRESENT' },
      ],
    });
    expect(days[1]).toMatchObject({
      base_version: null,
      entries: [{ student_id: 'student-1', status: 'LATE' }],
    });
    expect(body!.reason).toBe('Copied from paper register');
    expect(typeof body!.client_request_id).toBe('string');
    // Edit mode is left once saved.
    await waitFor(() => expect(screen.queryByRole('grid')).toBeNull());
  });

  it('requires a reason for an old date and sends nothing without it', async () => {
    setDesktop(true);
    let puts = 0;
    useMatrix(() => {
      puts += 1;
      return HttpResponse.json({ saved_dates: [], versions: {} });
    });
    const user = userEvent.setup();
    await openEditor();
    await user.click(await screen.findByRole('button', { name: 'Edit' }));
    (await screen.findByRole('gridcell', { name: /Karim Rahman, .*: Present/ })).focus();
    await user.keyboard('a');
    expect(screen.getByText(/outside the correction window/)).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Save (1)' }));
    expect((await screen.findByRole('alert')).textContent).toBe(
      'Write a reason of at least 3 letters.',
    );
    expect(puts).toBe(0);
  });

  it('sends no reason for an in-window day, and sends one after the server asks for it', async () => {
    setDesktop(true);
    const now = new Date();
    const month = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    const today = `${month}-${String(now.getDate()).padStart(2, '0')}`;
    const bodies: Record<string, unknown>[] = [];
    server.use(
      pinEnglishRegion,
      http.get('/api/v1/attendance/sections/:sectionId/register-matrix', () =>
        HttpResponse.json({
          dates: dates31(month),
          versions: { [today]: 1 },
          rows: [registerRow({ marks: { [today]: 'PRESENT' } })],
        }),
      ),
      http.put('/api/v1/attendance/sections/:sectionId/register-matrix', async ({ request }) => {
        bodies.push((await request.json()) as Record<string, unknown>);
        // Today's register is already FINALIZED: the server asks for a reason once.
        return bodies.length === 1
          ? HttpResponse.json(
              {
                statusCode: 422,
                message: 'reason',
                timestamp: new Date().toISOString(),
                path: '/attendance/sections/x/register-matrix',
                requestId: 'req-1',
                details: { code: 'ATTENDANCE_REASON_REQUIRED', dates: [today] },
              },
              { status: 422 },
            )
          : HttpResponse.json({ saved_dates: [today], versions: {} });
      }),
    );
    const user = userEvent.setup();
    await openEditor(
      'ADMIN',
      `/attendance/register?class_id=${CLASS_ID}&section_id=${SECTION_ID}&month=${month}`,
    );
    await user.click(await screen.findByRole('button', { name: 'Edit' }));
    (await screen.findByRole('gridcell', { name: /Karim Rahman, .*: Present/ })).focus();
    await user.keyboard('a');
    expect(screen.queryByText(/outside the correction window/)).toBeNull();
    await user.type(screen.getByLabelText(/Reason for correction/), 'Typed anyway');
    await user.click(screen.getByRole('button', { name: 'Save (1)' }));

    expect((await screen.findByRole('alert')).textContent).toBe(
      'Write a reason of at least 3 letters.',
    );
    expect(bodies[0]).not.toHaveProperty('reason');

    await user.click(screen.getByRole('button', { name: 'Save (1)' }));
    await waitFor(() => expect(bodies).toHaveLength(2));
    expect(bodies[1]!.reason).toBe('Typed anyway');
  });

  it('shows the conflicting dates, saves nothing, and Reload keeps edit mode with an empty draft', async () => {
    setDesktop(true);
    useMatrix(() =>
      HttpResponse.json(
        {
          statusCode: 409,
          message: 'conflict',
          timestamp: new Date().toISOString(),
          path: '/attendance/sections/x/register-matrix',
          requestId: 'req-1',
          details: { code: 'ATTENDANCE_MATRIX_CONFLICT', dates: ['2026-01-01'] },
        },
        { status: 409 },
      ),
    );
    const user = userEvent.setup();
    await openEditor();
    await user.click(await screen.findByRole('button', { name: 'Edit' }));
    (await screen.findByRole('gridcell', { name: /Karim Rahman, .*: Present/ })).focus();
    await user.keyboard('a');
    await user.type(screen.getByLabelText(/Reason for correction/), 'Paper register');
    await user.click(screen.getByRole('button', { name: 'Save (1)' }));

    expect(await screen.findByText('Nothing was saved')).toBeTruthy();
    expect(screen.getByText(/while you were editing/).textContent).toContain('2026');
    await user.click(screen.getByRole('button', { name: 'Reload the month' }));
    await waitFor(() => expect(screen.queryByText('Nothing was saved')).toBeNull());
    expect(screen.getByRole('grid')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Save (0)' }).hasAttribute('disabled')).toBe(true);
  });

  it('asks before discarding changes on Cancel', async () => {
    setDesktop(true);
    useMatrix();
    const user = userEvent.setup();
    await openEditor();
    await user.click(await screen.findByRole('button', { name: 'Edit' }));
    (await screen.findByRole('gridcell', { name: /Karim Rahman, .*: Present/ })).focus();
    await user.keyboard('a');
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    const dialog = await screen.findByRole('alertdialog');
    expect(within(dialog).getByText('1 changed cell will be lost.')).toBeTruthy();
    await user.click(within(dialog).getByRole('button', { name: 'Discard' }));
    await waitFor(() => expect(screen.queryByRole('grid')).toBeNull());
  });

  it('keeps the draft when the viewport drops below md mid-edit', async () => {
    setDesktop(true);
    useMatrix();
    const user = userEvent.setup();
    await openEditor();
    await user.click(await screen.findByRole('button', { name: 'Edit' }));
    (await screen.findByRole('gridcell', { name: /Karim Rahman, .*: Present/ })).focus();
    await user.keyboard('a');
    expect(await screen.findByText('1 cell changed')).toBeTruthy();

    const flip = (on: boolean) =>
      act(() => {
        setDesktop(on);
        window.matchMedia(MD_QUERY).dispatchEvent(new Event('change'));
      });
    flip(false);
    await waitFor(() => expect(screen.queryByRole('grid')).toBeNull());
    flip(true);

    expect(await screen.findByText('1 cell changed')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Save (1)' })).toBeTruthy();
  });

  it('on a phone: notice, no Edit button, ?edit is ignored, day numbers link to the roster', async () => {
    useMatrix();
    await openEditor('ADMIN', `${EDIT_URL}&edit=true`);
    await screen.findByRole('table');
    expect(screen.getByText(/cannot be edited on a phone/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Edit' })).toBeNull();
    expect(screen.queryByRole('grid')).toBeNull();
    const link = screen.getAllByRole('link', { name: /Open the register of/ })[0]!;
    expect(link.getAttribute('href')).toContain(`/attendance/${SECTION_ID}`);
    expect(link.getAttribute('href')).toContain('date=2026-01-01');
  });
});

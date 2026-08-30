import { toast } from '@biddaloy/ui/components';
import {
  apiErrorBody,
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
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { routeTree } from '../../routeTree.gen';

// [#361] Frozen so the suite means the same thing at 00:07 as it does at
// 14:00. Only `Date` is faked, so MSW, `waitFor`, and `userEvent` keep
// their real timers.
//
// Installed at module scope, not in `beforeEach`, because the fixtures
// below (`fatimaFees` et al.) are evaluated when the `describe` body runs
// — i.e. at collection time, before any `beforeEach` fires. A clock frozen
// later would disagree with them. Do not "tidy" this into `beforeEach`:
// that was tried first and it broke a passing test (see #361's plan) by
// leaving the fixtures built against the real clock instead.
vi.useFakeTimers({ toFake: ['Date'] });

// Vitest never restores fake timers between files, and nothing in the runner
// calls FakeTimers.dispose() — so with `isolate: false` (which [15.3]/#438
// turns on) the frozen clock installed above would leak into every other file
// that later runs in this same worker, and they would silently see this
// file's date. Module scope for the install is load-bearing (the fixtures
// below are evaluated at import time and must see the frozen clock), so the
// teardown goes in afterAll rather than afterEach.
afterAll(() => {
  vi.useRealTimers();
});

vi.setSystemTime(new Date('2026-03-15T18:30:00.000Z'));

/**
 * [5.3]'s fee breakdown and invoice history, exercised through the real
 * route tree — so `portal.tsx`'s `RequireRole` guard, `AppShell` and the
 * `?student=` search param all actually wire up — rather than the page
 * component in isolation. Same reasoning `portal/index.test.tsx`
 * documents for itself.
 *
 * The heading assertions are not stylistic: `useRouteFocus` focuses the
 * route's `<h1>`, so "exactly one per settled frame, zero while loading
 * or erroring" is a contract this page has to hold.
 */
describe('/portal/fees', () => {
  afterEach(async () => {
    await cleanupTestState();
    vi.unstubAllGlobals();
  });

  function child(name: string, id: string, className: string, section: string, roll: number) {
    return studentFactory({
      id,
      full_name: name,
      roll_number: roll,
      class_section: classSectionFactory({
        section_name: section,
        class: classFactory({ name: className }),
      }),
    });
  }

  /** A date `offsetDays` from today, as the server sends it. Relative
   * rather than a fixed calendar date so "overdue" stays overdue next
   * year.
   *
   * [#361] Built from the *local* calendar date, not `toISOString()`.
   * `parseServerDate` (`ui/src/utils/date.ts`) takes the UTC calendar date
   * out of the string and parses it at local midnight, so a `toISOString()`
   * fixture is off by a day in any zone ahead of UTC — the same shape as
   * `index.test.tsx`'s already-correct `dueDate()`. */
  function serverDate(offsetDays: number): string {
    const date = new Date();
    date.setDate(date.getDate() + offsetDays);
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T00:00:00.000Z`;
  }

  interface FeeInput {
    id: string;
    month: number;
    year: number;
    total: number;
    paid: number;
    discount?: number;
    status: 'PENDING' | 'PARTIALLY_PAID' | 'PAID' | 'WAIVED' | 'ADVANCE';
    dueInDays: number | null;
  }

  /** A literal `FamilyStudentFeeDto` — no `student` relation, no
   * `created_at`/`updated_at`. If the page reached for a staff-only field
   * this fixture would make it throw rather than quietly render. */
  function fee(studentId: string, input: FeeInput) {
    return {
      id: input.id,
      student_id: studentId,
      academic_year_id: 'ay-1',
      month: input.month,
      year: input.year,
      total_amount: input.total,
      paid_amount: input.paid,
      discount_amount: input.discount ?? 0,
      status: input.status,
      due_date: input.dueInDays === null ? null : serverDate(input.dueInDays),
      is_advance_payment: false,
    };
  }

  function summary(studentId: string, fees: ReturnType<typeof fee>[], payments: unknown[] = []) {
    const totalDue = fees.reduce((sum, f) => sum + f.total_amount, 0);
    const totalPaid = fees.reduce((sum, f) => sum + f.paid_amount, 0);
    const totalDiscount = fees.reduce((sum, f) => sum + f.discount_amount, 0);
    return {
      student_id: studentId,
      student_name: 'irrelevant',
      summary: {
        total_due: totalDue,
        total_paid: totalPaid,
        total_discount: totalDiscount,
        balance: totalDue - totalPaid - totalDiscount,
      },
      fee_breakdown: fees,
      payments,
    };
  }

  /** A literal `FamilyInvoiceDto`: `issued_by` is pinned `null` for a
   * family caller by design, so nothing on the row may depend on it. */
  function invoice(
    id: string,
    number: string,
    amount: number,
    status: string,
    issuedDaysAgo: number,
  ) {
    return {
      issued_by: null,
      id,
      invoice_number: number,
      student_id: 'student-1',
      student: null,
      student_fee_id: null,
      student_fee: null,
      total_amount: amount,
      tax_amount: 0,
      discount_amount: 0,
      status,
      issued_date: serverDate(-issuedDaysAgo),
      due_date: serverDate(-issuedDaysAgo + 30),
      line_items: {},
      notes: null,
      created_at: serverDate(-issuedDaysAgo),
      updated_at: serverDate(-issuedDaysAgo),
    };
  }

  const summaryRequests: string[] = [];
  const invoiceRequests: string[] = [];
  /** The `limit` each `GET /invoices` actually asked for. The default of
   * 10 hides part of a single year of monthly invoicing, so the value
   * sent is load-bearing, not incidental. */
  const invoiceLimits: (string | null)[] = [];

  beforeEach(() => {
    summaryRequests.length = 0;
    invoiceRequests.length = 0;
    invoiceLimits.length = 0;
  });

  function mockFees(options: {
    students: unknown[];
    summaries: Record<string, unknown>;
    invoices: Record<string, unknown[]>;
    /** Server-side `total` when it exceeds the rows returned — i.e. the
     * history is longer than one page. Defaults to the row count. */
    invoiceTotals?: Record<string, number>;
  }) {
    server.use(
      http.get('/api/v1/students/mine', () => HttpResponse.json(options.students)),
      http.get('/api/v1/payments/invoices/student/:studentId', ({ params }) => {
        const id = params.studentId as string;
        summaryRequests.push(id);
        return HttpResponse.json(options.summaries[id] ?? summary(id, []));
      }),
      http.get('/api/v1/invoices', ({ request }) => {
        const url = new URL(request.url);
        const studentId = url.searchParams.get('student_id') ?? '';
        invoiceRequests.push(studentId);
        invoiceLimits.push(url.searchParams.get('limit'));
        const rows = options.invoices[studentId] ?? [];
        const total = options.invoiceTotals?.[studentId] ?? rows.length;
        return HttpResponse.json({
          data: rows,
          total,
          page: 1,
          limit: Number(url.searchParams.get('limit') ?? 10),
          totalPages: Math.max(1, Math.ceil(total / rows.length || 1)),
        });
      }),
    );
  }

  /** The month row a given label sits in: the label's `<div>` header, one
   * level up. Used instead of a test id so the assertions run against the
   * markup a parent actually gets. */
  function monthRow(label: HTMLElement): HTMLElement {
    return (label.closest('div') as HTMLElement).parentElement as HTMLElement;
  }

  /** A row's `StatusBadge` text — queried by slot rather than by string,
   * because "Paid" is also the label of the row's paid figure. */
  function badgeText(row: HTMLElement): string[] {
    return Array.from(row.querySelectorAll('[data-slot="status-badge"]')).map(
      (node) => node.textContent ?? '',
    );
  }

  function renderFees(path = '/portal/fees', locale = 'en') {
    return renderWithRouter(routeTree, {
      initialEntries: [path],
      tenantId: 'tenant-1',
      role: 'PARENT',
      locale,
    });
  }

  const fatima = child('Fatima Rahman', 'student-1', 'Class 8', 'B', 14);
  const imran = child('Imran Rahman', 'student-2', 'Class 3', 'A', 7);

  const fatimaFees = [
    fee('student-1', {
      id: 'f-1',
      month: 9,
      year: 2025,
      total: 3000,
      paid: 0,
      status: 'PENDING',
      dueInDays: -12,
    }),
    fee('student-1', {
      id: 'f-2',
      month: 8,
      year: 2025,
      total: 3000,
      paid: 500,
      discount: 500,
      status: 'PARTIALLY_PAID',
      dueInDays: 30,
    }),
    fee('student-1', {
      id: 'f-3',
      month: 7,
      year: 2025,
      total: 3000,
      paid: 3000,
      status: 'PAID',
      dueInDays: -60,
    }),
  ];

  const fatimaInvoices = [
    invoice('inv-1', 'INV-2025-0912', 3000, 'OVERDUE', 12),
    invoice('inv-2', 'INV-2025-0811', 2500, 'ISSUED', 43),
    invoice('inv-3', 'INV-2025-0705', 3000, 'PAID', 74),
  ];

  function standardMocks(extra?: { invoiceTotals?: Record<string, number> }) {
    mockFees({
      ...extra,
      students: [fatima, imran],
      summaries: {
        'student-1': summary('student-1', fatimaFees, []),
        'student-2': summary(
          'student-2',
          [
            fee('student-2', {
              id: 'g-1',
              month: 9,
              year: 2025,
              total: 2000,
              paid: 2000,
              status: 'PAID',
              dueInDays: -12,
            }),
          ],
          [],
        ),
      },
      invoices: {
        'student-1': fatimaInvoices,
        'student-2': [invoice('inv-9', 'INV-2025-0999', 2000, 'PAID', 12)],
      },
    });
  }

  describe('the four acceptance figures', () => {
    it('renders outstanding as the headline with charged, discount and paid behind it', async () => {
      standardMocks();
      renderFees();

      // charged 9,000 · discount 500 · paid 3,500 · outstanding 5,000
      expect(await screen.findByText('৳5,000.00')).toBeTruthy();
      expect(screen.getByText('Outstanding')).toBeTruthy();
      expect(screen.getByText('৳9,000.00')).toBeTruthy();
      expect(screen.getByText('৳3,500.00')).toBeTruthy();
      expect(screen.getAllByText('Charged').length).toBeGreaterThan(0);
      expect(screen.getAllByText('Discount').length).toBeGreaterThan(0);
      expect(screen.getAllByText('Paid').length).toBeGreaterThan(0);
    });

    it('groups large amounts in lakh/crore, not thousands', async () => {
      mockFees({
        students: [fatima],
        summaries: {
          'student-1': summary('student-1', [
            fee('student-1', {
              id: 'f-1',
              month: 9,
              year: 2025,
              total: 120000,
              paid: 0,
              status: 'PENDING',
              dueInDays: -12,
            }),
          ]),
        },
        invoices: { 'student-1': [] },
      });
      const { localeReady } = renderFees();
      await localeReady;

      // ৳1,20,000.00 — not ৳120,000.00.
      expect((await screen.findAllByText('৳1,20,000.00')).length).toBeGreaterThan(0);
    });

    it('renders a zero discount as an em dash, never ৳0.00', async () => {
      mockFees({
        students: [fatima],
        summaries: {
          'student-1': summary('student-1', [
            fee('student-1', {
              id: 'f-1',
              month: 9,
              year: 2025,
              total: 3000,
              paid: 0,
              status: 'PENDING',
              dueInDays: 30,
            }),
          ]),
        },
        invoices: { 'student-1': [] },
      });
      renderFees();

      await screen.findByText('September 2025');
      // Two dashes: the summary's and the one month row's. Asserted
      // against the `<dd>` beside each "Discount" `<dt>`, so this can't
      // pass on a dash that happens to be somewhere else on the page —
      // ৳0.00 is a legitimate rendering elsewhere (nothing paid yet).
      const discounts = screen
        .getAllByText('Discount')
        .map((dt) => dt.nextElementSibling?.textContent);
      expect(discounts).toEqual(['—', '—']);
      expect(screen.getAllByText('—')).toHaveLength(2);
    });
  });

  describe('the month-by-month breakdown', () => {
    it('keeps paid months in the list, showing nothing outstanding', async () => {
      standardMocks();
      renderFees();

      const july = monthRow(await screen.findByText('July 2025'));
      // The regression this pins: `useFeeDues` drops PAID months entirely,
      // so a page sourced from it would silently hide July.
      expect(within(july).getByText('৳0.00')).toBeTruthy();
      expect(badgeText(july)).toEqual(['Paid']);
    });

    it('leads with the newest month', async () => {
      standardMocks();
      renderFees();

      await screen.findByText('September 2025');
      const months = screen
        .getAllByText(/^(September|August|July) 2025$/)
        .map((node) => node.textContent);
      expect(months).toEqual(['September 2025', 'August 2025', 'July 2025']);
    });

    it('derives Overdue from the due date, not from the status the server sent', async () => {
      standardMocks();
      renderFees();

      // The server never writes OVERDUE into student_fees — every open
      // month arrives as PENDING/PARTIALLY_PAID. A page rendering
      // `fee.status` verbatim would badge a 12-days-late month "Pending".
      const september = monthRow(await screen.findByText('September 2025'));
      expect(badgeText(september)).toEqual(['Overdue']);

      const august = monthRow(screen.getByText('August 2025'));
      expect(badgeText(august)).toEqual(['Partially paid']);
    });

    it('does not call a month due today overdue', async () => {
      // `parseServerDate` returns local midnight, so a naive
      // `< now` comparison flips to Overdue at 00:00 on the due date and
      // tells a parent they are late on the day they were asked to pay.
      // The server's `months_overdue` predicate matches this
      // (`sf.due_date < CURRENT_DATE`).
      mockFees({
        students: [fatima],
        summaries: {
          'student-1': summary('student-1', [
            fee('student-1', {
              id: 'today-1',
              month: 9,
              year: 2025,
              total: 3000,
              paid: 0,
              status: 'PENDING',
              dueInDays: 0,
            }),
          ]),
        },
        invoices: { 'student-1': [] },
      });
      renderFees();

      const row = monthRow(await screen.findByText('September 2025'));
      expect(badgeText(row)).toEqual(['Pending']);
    });

    it('says so plainly when nothing has been charged yet', async () => {
      mockFees({
        students: [fatima],
        summaries: { 'student-1': summary('student-1', []) },
        invoices: { 'student-1': [] },
      });
      renderFees();

      expect(await screen.findByText(/No fees have been charged yet/)).toBeTruthy();
      // Not an EmptyState — that renders an <h1>, and this frame has one.
      expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
    });
  });

  describe('invoice history', () => {
    it('renders the rows in the order the server delivered them', async () => {
      standardMocks();
      renderFees();

      await screen.findByText('INV-2025-0912');
      const numbers = screen.getAllByText(/^INV-2025-/).map((node) => node.textContent);
      expect(numbers).toEqual(['INV-2025-0912', 'INV-2025-0811', 'INV-2025-0705']);
      expect(screen.getByText('Newest first')).toBeTruthy();
    });

    it('asks for the whole history, not the ten-row default page', async () => {
      // `GET /invoices` defaults to limit=10 and a monthly fee schedule
      // issues twelve invoices a year, so the default drops invoices
      // inside a single school year. Regression for that.
      standardMocks();
      renderFees();

      await screen.findByText('INV-2025-0912');
      expect(invoiceLimits).toEqual(['100']);
    });

    it('says how many invoices it is showing when the history is longer', async () => {
      standardMocks({ invoiceTotals: { 'student-1': 112 } });
      renderFees();

      // Never silently truncated: a parent counting a missing month must
      // not conclude the school never issued it.
      expect(await screen.findByText(/most recent 3 of 112 invoices/i)).toBeTruthy();
    });

    it('says nothing about truncation when the whole history fits', async () => {
      standardMocks();
      renderFees();

      await screen.findByText('INV-2025-0912');
      expect(screen.queryByText(/most recent/i)).toBeNull();
    });

    it('does not make the row a link — there is no invoice detail page', async () => {
      standardMocks();
      renderFees();

      const number = await screen.findByText('INV-2025-0912');
      expect(number.closest('a')).toBeNull();
    });

    it('prints one invoice through the server-rendered printable view', async () => {
      standardMocks();
      // jsdom has no `URL.createObjectURL`; same stub
      // `_staff/invoices/index.test.tsx` uses for this flow.
      URL.createObjectURL = vi.fn(() => 'blob:mock');
      const printWindow = { opener: {}, location: { href: '' }, close: vi.fn() };
      const open = vi.fn(() => printWindow);
      vi.stubGlobal('open', open);
      server.use(
        http.get('/api/v1/invoices/:id/print', () => HttpResponse.text('<html>invoice</html>')),
      );
      try {
        renderFees();

        const button = await screen.findByRole('button', { name: 'Print invoice INV-2025-0912' });
        await userEvent.click(button);

        // The tab is opened *before* the request, inside the click's
        // user-activation window — that ordering is what stops a popup
        // blocker silently dropping it.
        expect(open).toHaveBeenCalledWith('', '_blank');
        await waitFor(() => expect(printWindow.location.href).toBe('blob:mock'));
      } finally {
        delete (URL as { createObjectURL?: typeof URL.createObjectURL }).createObjectURL;
      }
    });

    it('surfaces a blocked popup instead of looking like a no-op', async () => {
      standardMocks();
      // No `<Toaster>` is mounted in this route tree, so this asserts the
      // `toast.error` call rather than its rendered DOM — same approach
      // `_staff/invoices/index.test.tsx` takes.
      const toastSpy = vi.spyOn(toast, 'error').mockImplementation(() => '');
      vi.stubGlobal(
        'open',
        vi.fn(() => null),
      );
      try {
        renderFees();

        const button = await screen.findByRole('button', { name: 'Print invoice INV-2025-0912' });
        await userEvent.click(button);

        await waitFor(() =>
          expect(toastSpy).toHaveBeenCalledWith('Could not open the printable invoice. Try again.'),
        );
      } finally {
        toastSpy.mockRestore();
      }
    });

    it('says so plainly when there are no invoices', async () => {
      mockFees({
        students: [fatima],
        summaries: { 'student-1': summary('student-1', fatimaFees) },
        invoices: { 'student-1': [] },
      });
      renderFees();

      expect(await screen.findByText('No invoices yet.')).toBeTruthy();
    });
  });

  describe('choosing which student to look at', () => {
    it('renders a picker and re-queries both endpoints for the chosen child', async () => {
      standardMocks();
      renderFees();

      const picker = await screen.findByRole('navigation', { name: 'Choose a student' });
      // Defaults to the first linked student, which is what the landing
      // page links to.
      await waitFor(() => expect(summaryRequests).toContain('student-1'));
      expect(invoiceRequests).toContain('student-1');

      await userEvent.click(within(picker).getByRole('link', { name: /Imran Rahman/ }));

      await waitFor(() => expect(summaryRequests).toContain('student-2'));
      await waitFor(() => expect(invoiceRequests).toContain('student-2'));
      expect(await screen.findByText('INV-2025-0999')).toBeTruthy();
    });

    it('honours ?student= so a chosen child is bookmarkable', async () => {
      standardMocks();
      renderFees('/portal/fees?student=student-2');

      await waitFor(() => expect(summaryRequests).toEqual(['student-2']));
      expect(invoiceRequests).toEqual(['student-2']);
      expect(await screen.findByText(/Imran Rahman · Class 3 A · Roll 7/)).toBeTruthy();
    });

    it('falls back to the first student when ?student= names one the caller cannot see', async () => {
      standardMocks();
      renderFees('/portal/fees?student=someone-elses-child');

      // The param is never trusted to *widen* anything — the server
      // re-checks the link regardless, and the page does not forward an
      // id that is not in `/students/mine`.
      await waitFor(() => expect(summaryRequests).toEqual(['student-1']));
      expect(invoiceRequests).toEqual(['student-1']);
    });

    it('renders no picker at all for a caller who can see one student', async () => {
      mockFees({
        students: [fatima],
        summaries: { 'student-1': summary('student-1', fatimaFees) },
        invoices: { 'student-1': fatimaInvoices },
      });
      renderFees();

      await screen.findByText('September 2025');
      expect(screen.queryByRole('navigation', { name: 'Choose a student' })).toBeNull();
    });

    it('explains an account with no students linked to it', async () => {
      mockFees({ students: [], summaries: {}, invoices: {} });
      renderFees();

      expect(await screen.findByText('No students linked to you yet')).toBeTruthy();
      expect(summaryRequests).toEqual([]);
    });
  });

  describe('states and contracts', () => {
    it('shows no h1 while loading', async () => {
      standardMocks();
      renderFees();

      expect(screen.queryByRole('heading', { level: 1 })).toBeNull();
      await screen.findByText('September 2025');
    });

    it('has exactly one h1 once settled: the page title', async () => {
      standardMocks();
      renderFees();

      await screen.findByText('September 2025');
      expect(screen.getAllByRole('heading', { level: 1 }).map((h) => h.textContent)).toEqual([
        'Fees',
      ]);
      expect(screen.getAllByRole('heading', { level: 2 }).map((h) => h.textContent)).toContain(
        'Month by month',
      );
    });

    it('shows a retryable error, with no h1 and no raw id, when the breakdown fails', async () => {
      server.use(
        http.get('/api/v1/students/mine', () => HttpResponse.json([fatima])),
        http.get('/api/v1/payments/invoices/student/:studentId', () =>
          HttpResponse.json(
            apiErrorBody(
              500,
              'Student with ID "9f1c3d20-1111-4aaa-bbbb-0123456789ab" not found',
              '/api/v1/payments/invoices/student/student-1',
            ),
            { status: 500 },
          ),
        ),
        http.get('/api/v1/invoices', () =>
          HttpResponse.json({ data: [], total: 0, page: 1, limit: 10, totalPages: 1 }),
        ),
      );
      renderFees();

      // `shouldRetryQuery` retries a 500 before giving up, so the error
      // frame is several seconds away — same budget `portal/index.test.tsx`
      // allows for its own error frames.
      expect(
        await screen.findByText(/Could not load these fees/, {}, { timeout: 15000 }),
      ).toBeTruthy();
      expect(screen.getByRole('button', { name: 'Try again' })).toBeTruthy();
      expect(screen.queryByRole('heading', { level: 1 })).toBeNull();
      expect(document.body.textContent).not.toContain('9f1c3d20');
    });

    it('shows the same error frame when the invoice list fails', async () => {
      server.use(
        http.get('/api/v1/students/mine', () => HttpResponse.json([fatima])),
        http.get('/api/v1/payments/invoices/student/:studentId', () =>
          HttpResponse.json(summary('student-1', fatimaFees)),
        ),
        http.get('/api/v1/invoices', () =>
          HttpResponse.json(apiErrorBody(500, 'boom', '/api/v1/invoices'), { status: 500 }),
        ),
      );
      renderFees();

      expect(
        await screen.findByText(/Could not load these fees/, {}, { timeout: 15000 }),
      ).toBeTruthy();
      // A half-rendered page would imply the breakdown half is complete.
      expect(screen.queryByText('September 2025')).toBeNull();
    });

    it('offers no way to pay — self-service payment is #291', async () => {
      standardMocks();
      renderFees();

      await screen.findByText('September 2025');
      expect(screen.queryByText(/Pay now/i)).toBeNull();
    });

    it('is axe clean', async () => {
      standardMocks();
      const { container } = renderFees();

      await screen.findByText('September 2025');
      await expect(container).toHaveNoViolations();
    });

    it('renders in Bangla without falling back to raw keys', async () => {
      standardMocks();
      const { localeReady } = renderFees('/portal/fees', 'bn');
      await localeReady;

      // The year is rendered in Bengali numerals too — a month label must
      // not be the one Latin number left on the page.
      expect(await screen.findByText('সেপ্টেম্বর ২০২৫')).toBeTruthy();
      expect(screen.getByText('মাসভিত্তিক হিসাব')).toBeTruthy();
      expect(screen.getByText('চালান')).toBeTruthy();
      expect(document.body.textContent).not.toContain('fees.');
    });
  });
});

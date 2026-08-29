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
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';

import { routeTree } from '../../routeTree.gen';

// [#361] Frozen so the suite means the same thing at 00:07 as it does at
// 14:00. Only `Date` is faked, so MSW, `waitFor`, and `userEvent` keep
// their real timers.
//
// Installed at module scope, not in `beforeEach`, because this file's
// fixture helpers (`dueDate`, `payment`) are called from inside `it`
// blocks but also, for some suites, from the `describe` body itself at
// collection time — a clock frozen later than that would disagree with
// them. Do not "tidy" this into `beforeEach`: see `fees.test.tsx`'s
// identical comment for why that shape broke a passing test.
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
 * [5.2]'s portal landing, exercised through the real route tree (so
 * `portal.tsx`'s `RequireRole` guard, `AppShell` and the `BottomNav` all
 * actually wire up) rather than the page component in isolation — same
 * reasoning `_staff/fees/dues.test.tsx` documents for itself.
 *
 * The heading assertions here are not stylistic. `useRouteFocus` finds a
 * route's heading with `querySelector('h1')` and focuses it after a
 * navigation, so "exactly one `<h1>` per settled frame, zero while
 * loading or erroring" is the contract this page has to hold — see the
 * table in `index.tsx`'s header comment.
 */
describe('/portal', () => {
  afterEach(async () => {
    await cleanupTestState();
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

  /** A date `offsetDays` from today, as the server would send it.
   * Relative rather than a hardcoded calendar date so "12 days late" stays
   * 12 days late next year. */
  function dueDate(offsetDays: number): string {
    const date = new Date();
    date.setDate(date.getDate() + offsetDays);
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T00:00:00.000Z`;
  }

  interface DueEntryInput {
    balance: number;
    /** **Only the two statuses the server can actually produce.**
     * `GET /fees/dues` selects `status IN (PENDING, PARTIALLY_PAID)`
     * (`fee-dues.service.ts`'s `OPEN_STATUSES`) and nothing server-side
     * ever writes `OVERDUE` into `student_fees`. A fixture that fabricated
     * `status: 'OVERDUE'` would test a response shape production cannot
     * emit — and would hide the fact that the page never detects overdue
     * at all. Overdue is derived from `months_overdue`, below. */
    status: 'PENDING' | 'PARTIALLY_PAID';
    /** Days from today; negative is in the past. */
    dueInDays: number;
  }

  function dueRow(studentId: string, fullName: string, entries: DueEntryInput[]) {
    return {
      student_id: studentId,
      full_name: fullName,
      registration_number: 'REG-1',
      roll_number: 1,
      class_name: 'Class 8',
      section_name: 'B',
      total_due: entries.reduce((sum, entry) => sum + entry.balance, 0),
      // Exactly the server's own definition: `COUNT(*) FILTER (WHERE
      // sf.due_date IS NOT NULL AND sf.due_date < NOW())`.
      months_overdue: entries.filter((entry) => entry.dueInDays < 0).length,
      // Deliberately the *family* row shape — no `reminder_threshold_date`,
      // no `guardians`. The page must not read a staff-only field.
      dues: entries.map((entry, index) => ({
        student_fee_id: `fee-${studentId}-${index}`,
        month: 3,
        year: 2026,
        total_amount: entry.balance,
        paid_amount: 0,
        discount_amount: 0,
        balance: entry.balance,
        status: entry.status,
        due_date: dueDate(entry.dueInDays),
      })),
    };
  }

  function mockPortal(students: unknown[], dues: unknown[], payments: unknown[] = []) {
    server.use(
      http.get('/api/v1/students/mine', () => HttpResponse.json(students)),
      http.get('/api/v1/fees/dues', () =>
        HttpResponse.json({
          data: dues,
          total: dues.length,
          page: 1,
          limit: 50,
          totalPages: 1,
        }),
      ),
      http.get('/api/v1/payments/student/:studentId', () => HttpResponse.json(payments)),
    );
  }

  function renderPortal(locale = 'en') {
    return renderWithRouter(routeTree, {
      initialEntries: ['/portal'],
      tenantId: 'tenant-1',
      role: 'PARENT',
      locale,
    });
  }

  describe('a parent with several children', () => {
    const students = [
      child('Fatima Rahman', 'student-1', 'Class 8', 'B', 14),
      child('Imran Rahman', 'student-2', 'Class 3', 'A', 7),
      child('Ayesha Rahman', 'student-3', 'Class 1', 'A', 22),
    ];
    const dues = [
      // Every entry says PENDING, because that is all the server can say.
      // Fatima is nonetheless overdue: her due date has passed, which is
      // what `months_overdue` reports.
      dueRow('student-1', 'Fatima Rahman', [{ balance: 5000, status: 'PENDING', dueInDays: -12 }]),
      dueRow('student-2', 'Imran Rahman', [{ balance: 6000, status: 'PENDING', dueInDays: 50 }]),
      // student-3 has no dues row at all — the /fees/dues response only
      // carries students who owe something.
    ];

    it('totals only the children who owe, and says how many that is', async () => {
      mockPortal(students, dues);
      renderPortal();

      expect(await screen.findByText('৳11,000.00')).toBeTruthy();
      expect(screen.getByText(/Across 2 of 3 children/)).toBeTruthy();
      expect(screen.getByText(/৳5,000\.00 overdue/)).toBeTruthy();
    });

    it('still shows the paid-up child, reading "Nothing due" with a Paid badge', async () => {
      mockPortal(students, dues);
      renderPortal();

      expect(await screen.findByText('Ayesha Rahman')).toBeTruthy();
      expect(screen.getByText('Nothing due')).toBeTruthy();
      expect(screen.getByText('Paid')).toBeTruthy();
      // Status is never carried by amount colour alone — each child's
      // badge repeats it as text.
      expect(screen.getByText('Overdue')).toBeTruthy();
      expect(screen.getByText('Pending')).toBeTruthy();
    });

    it('derives Overdue from months_overdue, even though every entry says PENDING', async () => {
      mockPortal(students, dues);
      renderPortal();

      // The regression this pins: `GET /fees/dues` can only ever return
      // PENDING/PARTIALLY_PAID entries, so a page keying "overdue" off
      // `due.status` shows a parent 12 days late a neutral Pending badge.
      const card = (await screen.findByText('Fatima Rahman')).closest(
        '[data-slot="card"]',
      ) as HTMLElement;
      expect(within(card).getByText('Overdue')).toBeTruthy();
      expect(within(card).getByText(/12 days late/)).toBeTruthy();
      // ...and the sibling whose due date is still in the future is not
      // swept up with her.
      const sibling = (await screen.findByText('Imran Rahman')).closest(
        '[data-slot="card"]',
      ) as HTMLElement;
      expect(within(sibling).getByText('Pending')).toBeTruthy();
      expect(within(sibling).queryByText(/days late/)).toBeNull();
    });

    it('counts only the overdue portion in the hero, not the whole balance of an overdue child', async () => {
      mockPortal(
        [students[0], students[1]],
        [
          // One child, ৳2,000 past due and ৳3,000 not due yet. She is
          // overdue — but only by ৳2,000.
          dueRow('student-1', 'Fatima Rahman', [
            { balance: 2000, status: 'PENDING', dueInDays: -30 },
            { balance: 3000, status: 'PENDING', dueInDays: 30 },
          ]),
          dueRow('student-2', 'Imran Rahman', [
            { balance: 1000, status: 'PENDING', dueInDays: 10 },
          ]),
        ],
      );
      renderPortal();

      expect(await screen.findByText('৳6,000.00')).toBeTruthy();
      expect(screen.getByText(/৳2,000\.00 overdue/)).toBeTruthy();
      expect(screen.queryByText(/৳5,000\.00 overdue/)).toBeNull();
    });

    // Only `SingleStudentView` carries `RecentPayments`; the multi-child frame
    // is child cards alone. That asymmetry is a known gap, not an oversight —
    // a merged, child-attributed feed for this frame is #339. This test pins
    // today's behaviour so #339 has to change it deliberately rather than
    // arriving as a silent side effect of some other portal change.
    it('shows no recent-payments feed on the multi-child frame', async () => {
      mockPortal(students, dues);
      renderPortal();

      await screen.findByText('Ayesha Rahman');
      expect(screen.queryByText('Recent payments')).toBeNull();
    });

    it('leads with content — there is no greeting anywhere', async () => {
      mockPortal(students, dues);
      renderPortal();

      await screen.findByText('Ayesha Rahman');
      expect(screen.queryByText(/Assalamu alaikum/i)).toBeNull();
      expect(screen.queryByText(/2025–26/)).toBeNull();
    });

    it('makes each child card a link into that child\u2019s fee view', async () => {
      mockPortal(students, dues);
      renderPortal();

      // The whole card is the link, not a "view" control inside it — so
      // the tap target is the card and there is no nested interactive
      // element for a screen reader to step through.
      const link = (await screen.findByText('Fatima Rahman')).closest('a') as HTMLAnchorElement;
      expect(link).toBeTruthy();
      expect(link.getAttribute('href')).toBe('/portal/fees?student=student-1');
      expect(link.getAttribute('data-slot')).toBe('card');

      // Every child gets their own, including the paid-up one.
      expect(
        (screen.getByText('Ayesha Rahman').closest('a') as HTMLAnchorElement).getAttribute('href'),
      ).toBe('/portal/fees?student=student-3');
    });

    it('reconciles the hero total against the cards of the children who owe', async () => {
      mockPortal(students, dues);
      renderPortal();

      // The hero counts only children who owe — 5,000 + 6,000 — and the
      // paid-up child contributes nothing. This is [5.2]'s deliberate
      // semantics, restated here as the arithmetic a parent does by eye.
      expect(await screen.findByText('\u09f311,000.00')).toBeTruthy();
      const owing = ['Fatima Rahman', 'Imran Rahman'].map((name) => {
        const card = screen.getByText(name).closest('[data-slot="card"]') as HTMLElement;
        return within(card).getByText(/\u09f3/).textContent;
      });
      expect(owing).toEqual(['\u09f35,000.00', '\u09f36,000.00']);
      const paidUp = screen.getByText('Ayesha Rahman').closest('[data-slot="card"]') as HTMLElement;
      expect(within(paidUp).getByText('Nothing due')).toBeTruthy();
    });

    it('has exactly one h1: the hero label', async () => {
      mockPortal(students, dues);
      renderPortal();

      await screen.findByText('Ayesha Rahman');
      const headings = screen.getAllByRole('heading', { level: 1 });
      expect(headings.map((h) => h.textContent)).toEqual(['Total outstanding']);
      // Section titles stay h2 — `useRouteFocus` never looks at them.
      expect(screen.getAllByRole('heading', { level: 2 }).map((h) => h.textContent)).toContain(
        'Your children',
      );
    });

    it('is axe clean', async () => {
      mockPortal(students, dues);
      const { container } = renderPortal();

      await screen.findByText('Ayesha Rahman');
      await expect(container).toHaveNoViolations();
    });

    it('groups large amounts in lakh/crore, not thousands', async () => {
      const twoChildren = students.slice(0, 2);
      mockPortal(twoChildren, [
        dueRow('student-1', 'Fatima Rahman', [
          { balance: 60000, status: 'PENDING', dueInDays: -12 },
        ]),
        dueRow('student-2', 'Imran Rahman', [
          { balance: 60000, status: 'PENDING', dueInDays: -12 },
        ]),
      ]);
      const { localeReady } = renderPortal('en');
      await localeReady;

      // 1,20,000 — not 120,000. BD grouping comes from the region config's
      // `grouping: 'lakh-crore'`, via the shared `formatServerAmount`.
      expect(await screen.findByText('৳1,20,000.00')).toBeTruthy();
    });
  });

  describe('a single student (parent of one, or the student themselves)', () => {
    const students = [child('Fatima Rahman', 'student-1', 'Class 8', 'B', 14)];
    const dues = [
      dueRow('student-1', 'Fatima Rahman', [{ balance: 5000, status: 'PENDING', dueInDays: -12 }]),
    ];
    const payments = [
      {
        id: 'payment-1',
        student_id: 'student-1',
        total_amount: 5000,
        payment_method: 'CASH',
        payment_status: 'SUCCESS',
        transaction_reference: null,
        invoice_id: null,
        payment_date: '2025-07-15T00:00:00.000Z',
        created_at: '2025-07-15T00:00:00.000Z',
      },
      {
        id: 'payment-2',
        student_id: 'student-1',
        total_amount: 6000,
        payment_method: 'ONLINE',
        payment_status: 'SUCCESS',
        transaction_reference: 'TRX8891QW',
        invoice_id: null,
        payment_date: '2025-04-12T00:00:00.000Z',
        created_at: '2025-04-12T00:00:00.000Z',
      },
    ];

    it('promotes the student into the header instead of rendering a one-item list', async () => {
      mockPortal(students, dues, payments);
      renderPortal();

      expect(await screen.findByRole('heading', { level: 1, name: 'Fatima Rahman' })).toBeTruthy();
      expect(screen.getByText('Class 8 B · Roll 14')).toBeTruthy();
      expect(screen.queryByText('Your children')).toBeNull();
    });

    it('offers no switching UI at all to a guardian of exactly one child', async () => {
      mockPortal(students, dues, payments);
      renderPortal();

      await screen.findByRole('heading', { level: 1, name: 'Fatima Rahman' });
      // No picker, and the promoted student is not itself a drill-down
      // link — there is nowhere else to switch to.
      expect(screen.queryByRole('navigation', { name: 'Choose a student' })).toBeNull();
      expect(screen.queryByRole('link', { name: /Fatima Rahman/ })).toBeNull();
    });

    it('has exactly one h1: the student name, not the hero label', async () => {
      mockPortal(students, dues, payments);
      renderPortal();

      await screen.findByText('Class 8 B · Roll 14');
      expect(screen.getAllByRole('heading', { level: 1 }).map((h) => h.textContent)).toEqual([
        'Fatima Rahman',
      ]);
      // The hero label is still on the page — just not as a heading.
      expect(screen.getByText('Total outstanding')).toBeTruthy();
    });

    it('renders recent payments with method and transaction reference, never a receipt number', async () => {
      mockPortal(students, dues, payments);
      renderPortal();

      const heading = await screen.findByRole('heading', { level: 2, name: 'Recent payments' });
      const card = heading.parentElement as HTMLElement;
      expect(await within(card).findByText('Cash')).toBeTruthy();
      expect(within(card).getByText('Online · TRX8891QW')).toBeTruthy();
      expect(within(card).getByText('৳5,000.00')).toBeTruthy();
      expect(screen.queryByText(/RCP-/)).toBeNull();
    });

    it('renders family-shaped payment rows — which carry no student or received_by — without crashing', async () => {
      mockPortal(students, dues, payments);
      renderPortal();

      await screen.findByRole('heading', { level: 2, name: 'Recent payments' });
      // The fixture above is a literal `FamilyPaymentDto`: no `student`,
      // no `received_by`, no `remarks`. If the page reached for one of
      // those, this frame would throw rather than render.
      expect(await screen.findByText('See all payments')).toBeTruthy();
    });

    it('says so plainly when no payment has been recorded yet', async () => {
      mockPortal(students, dues, []);
      renderPortal();

      expect(await screen.findByText('No payments recorded yet.')).toBeTruthy();
      // Not an EmptyState — that renders an <h1>, and this frame already
      // has one.
      expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
    });

    it('offers a fee breakdown link and no pay-now action', async () => {
      mockPortal(students, dues, payments);
      renderPortal();

      const link = await screen.findByRole('link', { name: 'View fee breakdown' });
      expect(link.getAttribute('href')).toBe('/portal/fees');
      expect(screen.queryByText(/Pay now/i)).toBeNull();
    });

    it('is axe clean', async () => {
      mockPortal(students, dues, payments);
      const { container } = renderPortal();

      await screen.findByRole('heading', { level: 2, name: 'Recent payments' });
      await expect(container).toHaveNoViolations();
    });
  });

  describe('payments that did not succeed', () => {
    const students = [child('Fatima Rahman', 'student-1', 'Class 8', 'B', 14)];

    function payment(id: string, status: string, dayOffset: number, amount: number) {
      const date = new Date();
      date.setDate(date.getDate() + dayOffset);
      // [#361] Local noon, not whatever time `new Date()` happened to
      // return. The assertion below rebuilds the expected "Last paid"
      // stamp from this same instant's local calendar date — pinning to
      // noon means that round trip can never cross a UTC day boundary,
      // in any zone within ±12 hours of UTC.
      date.setHours(12, 0, 0, 0);
      return {
        id,
        student_id: 'student-1',
        total_amount: amount,
        payment_method: 'CHEQUE',
        payment_status: status,
        transaction_reference: null,
        invoice_id: null,
        payment_date: date.toISOString(),
        created_at: date.toISOString(),
      };
    }

    it('never lets a bounced cheque date the "Last paid" line', async () => {
      // No dues row at all => paid up, so the hero falls through to
      // "Last paid". The newest payment FAILED; the real receipt is older.
      mockPortal(
        students,
        [],
        [payment('p-2', 'FAILED', -1, 5000), payment('p-1', 'SUCCESS', -30, 5000)],
      );
      renderPortal();

      await screen.findByRole('heading', { level: 1, name: 'Fatima Rahman' });
      const expected = new Date();
      expected.setDate(expected.getDate() - 30);
      const pad = (n: number) => String(n).padStart(2, '0');
      const stamp = `${expected.getFullYear()}-${pad(expected.getMonth() + 1)}-${pad(expected.getDate())}`;
      expect(await screen.findByText(`Last paid ${stamp}`)).toBeTruthy();
    });

    it('says nothing about a last payment when every attempt failed', async () => {
      mockPortal(students, [], [payment('p-1', 'FAILED', -1, 5000)]);
      renderPortal();

      await screen.findByRole('heading', { level: 1, name: 'Fatima Rahman' });
      await screen.findByRole('heading', { level: 2, name: 'Recent payments' });
      expect(screen.queryByText(/Last paid/)).toBeNull();
    });

    it('still lists the failed attempt, labelled — a parent who paid must not see nothing', async () => {
      mockPortal(students, [], [payment('p-1', 'FAILED', -1, 5000)]);
      renderPortal();

      const heading = await screen.findByRole('heading', { level: 2, name: 'Recent payments' });
      const card = heading.parentElement as HTMLElement;
      expect(await within(card).findByText('Failed')).toBeTruthy();
      expect(within(card).queryByText('No payments recorded yet.')).toBeNull();
    });

    it('leaves a successful payment unbadged — success is the unremarkable case', async () => {
      mockPortal(students, [], [payment('p-1', 'SUCCESS', -1, 5000)]);
      renderPortal();

      const heading = await screen.findByRole('heading', { level: 2, name: 'Recent payments' });
      const card = heading.parentElement as HTMLElement;
      await within(card).findByText('Cheque');
      expect(within(card).queryByText('Success')).toBeNull();
      expect(within(card).queryByText('Failed')).toBeNull();
    });
  });

  describe('an unlinked account', () => {
    it('explains what to do rather than showing an error', async () => {
      mockPortal([], []);
      renderPortal();

      expect(await screen.findByText('No students linked to you yet')).toBeTruthy();
      expect(screen.getByText(/Ask the school office/)).toBeTruthy();
      expect(screen.queryByRole('alert')).toBeNull();
    });

    it('uses the EmptyState title as the frame’s only h1', async () => {
      mockPortal([], []);
      renderPortal();

      await screen.findByText('No students linked to you yet');
      expect(screen.getAllByRole('heading', { level: 1 }).map((h) => h.textContent)).toEqual([
        'No students linked to you yet',
      ]);
    });

    it('refetches when the parent checks again', async () => {
      let calls = 0;
      server.use(
        http.get('/api/v1/students/mine', () => {
          calls += 1;
          return HttpResponse.json([]);
        }),
        http.get('/api/v1/fees/dues', () =>
          HttpResponse.json({ data: [], total: 0, page: 1, limit: 50, totalPages: 1 }),
        ),
      );
      renderPortal();

      const user = userEvent.setup();
      await user.click(await screen.findByRole('button', { name: 'Check again' }));

      await waitFor(() => expect(calls).toBeGreaterThan(1));
    });
  });

  describe('failure and loading', () => {
    it('shows one whole-page error with a retry, and never a raw id', async () => {
      server.use(
        http.get('/api/v1/students/mine', () =>
          HttpResponse.json(apiErrorBody(500, 'boom', '/api/v1/students/mine'), { status: 500 }),
        ),
        http.get('/api/v1/fees/dues', () =>
          HttpResponse.json({ data: [], total: 0, page: 1, limit: 50, totalPages: 1 }),
        ),
      );
      renderPortal();

      const alert = await screen.findByRole('alert', {}, { timeout: 15000 });
      expect(alert.textContent).toContain('Could not load your portal');
      expect(alert.textContent).not.toMatch(/student-\d|tenant-\d|500/);
      // Zero h1 in the error frame — focus falls back to the <main>
      // landmark by design.
      expect(screen.queryAllByRole('heading', { level: 1 })).toHaveLength(0);
    });

    it('retries both queries from the error frame', async () => {
      let studentCalls = 0;
      server.use(
        http.get('/api/v1/students/mine', () => {
          studentCalls += 1;
          return studentCalls > 3
            ? HttpResponse.json([child('Fatima Rahman', 'student-1', 'Class 8', 'B', 14)])
            : HttpResponse.json(apiErrorBody(500, 'boom', '/api/v1/students/mine'), {
                status: 500,
              });
        }),
        http.get('/api/v1/fees/dues', () =>
          HttpResponse.json({ data: [], total: 0, page: 1, limit: 50, totalPages: 1 }),
        ),
        http.get('/api/v1/payments/student/:studentId', () => HttpResponse.json([])),
      );
      renderPortal();

      const user = userEvent.setup();
      await user.click(
        await screen.findByRole('button', { name: 'Try again' }, { timeout: 15000 }),
      );

      expect(await screen.findByRole('heading', { level: 1, name: 'Fatima Rahman' })).toBeTruthy();
    });

    it('shows skeletons — never a blank frame or a bare id — while loading, with no h1', async () => {
      server.use(
        http.get('/api/v1/students/mine', () => new Promise(() => {})),
        http.get('/api/v1/fees/dues', () => new Promise(() => {})),
      );
      const { container } = renderPortal();

      await waitFor(() =>
        expect(container.querySelectorAll('[data-slot="skeleton"]').length).toBeGreaterThan(0),
      );
      expect(screen.queryAllByRole('heading', { level: 1 })).toHaveLength(0);
      expect(screen.getByText('Loading your portal')).toBeTruthy();
    });

    it('switches to the single-student skeleton shape once the student count is known, even while dues is still pending', async () => {
      server.use(
        http.get('/api/v1/students/mine', () =>
          HttpResponse.json([child('Fatima Rahman', 'student-1', 'Class 8', 'B', 14)]),
        ),
        http.get('/api/v1/fees/dues', () => new Promise(() => {})),
      );
      const { container } = renderPortal();

      // `w-40` is unique to the single-student shape's name placeholder —
      // the multi-child shape never uses it. Its appearance here, while
      // `duesQuery` is still unresolved, is the regression this pins: the
      // skeleton must not wait for both queries before picking a shape.
      await waitFor(() =>
        expect(container.querySelector('[data-slot="skeleton"].w-40')).toBeTruthy(),
      );
      expect(screen.queryAllByRole('heading', { level: 1 })).toHaveLength(0);
    });
  });

  it('renders the whole page in Bangla when the locale is bn', async () => {
    mockPortal(
      [
        child('ফাতিমা রহমান', 'student-1', 'ক্লাস ৮', 'খ', 14),
        child('ইমরান রহমান', 'student-2', 'ক্লাস ৩', 'ক', 7),
      ],
      [dueRow('student-1', 'ফাতিমা রহমান', [{ balance: 5000, status: 'PENDING', dueInDays: -12 }])],
    );
    const { localeReady } = renderPortal('bn');
    await localeReady;

    expect(await screen.findByRole('heading', { level: 1, name: 'মোট বকেয়া' })).toBeTruthy();
    expect(screen.getByText('আপনার সন্তানেরা')).toBeTruthy();
    expect(screen.getByText('কোনো বকেয়া নেই')).toBeTruthy();
    // bn-BD's region config uses Bengali numerals, so the amount is not
    // just translated copy around Latin digits.
    expect(screen.getAllByText(/৫,০০০/).length).toBeGreaterThan(0);
  });
});

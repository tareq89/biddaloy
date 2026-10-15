import { apiSession, get } from '../api';
import { expect, loggedIn, test } from '../fixtures/test';
import { t } from '../i18n';

import {
  allPages,
  dbCount,
  dhakaDay,
  expectSame,
  getJson,
  roleSession,
  round2,
  rowsOf,
  sumAllPages,
  totalOf,
  widget,
} from './dashboard-reconciliation.helpers';

/**
 * [8.10.7.6.06] Reconciliation sweep (Epic 169 D29: "source pages and widgets share the
 * same query"). For every dashboard number that has a source page, read the widget and
 * the source endpoint in the same test, as the role that sees it, on the full e2e seed,
 * and assert they agree. A mismatch prints both numbers and both URLs.
 *
 * Where two numbers differ by a documented rule the test asserts that relation and says
 * why in a `RULE:` comment. Basis rules used below:
 *  - Money widgets read "applied to bills" = `GET /reports/collections` `totals.net`
 *    (payments minus reversals). The report's `by_method` figures are cash actually
 *    received, so they differ from `totals.net` by wallet use (`wallet_used` out,
 *    `wallet_added` in).
 *  - The attendance percentage uses the school policy (default: late counts as present,
 *    leave leaves the denominator): `(present + late) / (present + late + absent)`.
 *  - Dashboards count FINALIZED registers only. A DRAFT register is on the register
 *    screen but not in a dashboard number.
 *
 * The widgets are cached for 60 s (D24). A widget whose source other specs write to during the
 * run goes through `whileOthersWrite`. Not covered here (no widget on this branch, or no
 * source endpoint): see the comments on `committee-attendance`.
 * [8.10.7.7.07] adds approvals-pending (vs `GET /applications?view=inbox`), print-queue
 * (vs `GET /print-history/queue`), syllabus-vs-plan (vs syllabus-progress) and
 * my-lessons-to-mark (vs the teacher's plan schedules).
 */

const TODAY = dhakaDay();
const MONTH_START = `${TODAY.slice(0, 8)}01`;

/**
 * RULE: other workers add payments, students, applicants, applications and print jobs while
 * this file runs, and a widget is cached for 60 s, so a widget read can lag its source. The
 * comparison stays exact; it is only repeated until a fresh cache entry and the source agree.
 */
async function whileOthersWrite(compare: () => Promise<void>): Promise<void> {
  test.setTimeout(120_000);
  await expect(compare).toPass({ intervals: [5_000], timeout: 90_000 });
}

interface Counts {
  present: number;
  late: number;
  absent: number;
  leave: number;
}

/** The default attendance policy percentage over a tally (leave is out of the denominator). */
const attendancePct = (c: Counts): number | null => {
  const denominator = c.present + c.late + c.absent;
  return denominator === 0 ? null : round2(((c.present + c.late) / denominator) * 100);
};

const addMonthsIso = (isoDay: string, months: number): string => {
  const d = new Date(`${isoDay}T00:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() + months);
  return d.toISOString().slice(0, 10);
};

const lastDayOf = (year: number, month: number): number =>
  new Date(Date.UTC(year, month, 0)).getUTCDate();

const addDaysIso = (isoDay: string, days: number): string => {
  const d = new Date(`${isoDay}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
};

const sortedIds = (ids: string[]): string[] => [...ids].sort();

interface CollectionsReport {
  totals: {
    collected: number;
    reversed: number;
    net: number;
    wallet_used: number;
    wallet_added: number;
  };
  by_method: { payment_method: string; net: number }[];
}

const reportUrl = (from: string, to: string) => `/reports/collections?from=${from}&to=${to}`;

/** Σ per-method cash nets, and the relation it has to `totals.net` (wallet use). */
function expectMethodsSumToNet(report: CollectionsReport, label: string): void {
  const sum = round2(report.by_method.reduce((n, m) => n + m.net, 0));
  // RULE: by_method is cash actually received; totals.net is applied to bills.
  // They differ only by wallet credit: net_cash = net - wallet_used + wallet_added.
  const { net, wallet_used: used, wallet_added: added } = report.totals;
  expect(
    sum,
    `${label}: Σ by_method.net ${sum} vs totals.net ${net} (wallet −${used} +${added})`,
  ).toBe(round2(net - used + added));
}

// ---------------------------------------------------------------------------------------
// ADMIN
// ---------------------------------------------------------------------------------------

test.describe('dashboard reconciliation: admin', () => {
  test('attendance-today = GET /attendance/my-sections for today', async ({ request }) => {
    const w = await widget<{
      counts: Counts & { unmarked: number };
      percentage: number | null;
      sections_total: number;
      pending_sections: { section_id: string }[];
    }>(request, 'admin', 'attendance-today');
    const sourceUrl = `/attendance/my-sections?date=${TODAY}`;
    const rows = await getJson<
      {
        section_id: string;
        is_working_day: boolean;
        today: (Counts & { state: string; unmarked: number }) | null;
      }[]
    >(request, 'admin', sourceUrl);

    const sum: Counts & { unmarked: number } = {
      present: 0,
      late: 0,
      absent: 0,
      leave: 0,
      unmarked: 0,
    };
    for (const row of rows) {
      for (const k of Object.keys(sum) as (keyof typeof sum)[]) sum[k] += row.today?.[k] ?? 0;
    }
    const url = '/dashboard/widgets/attendance-today';
    expectSame('attendance counts', w.counts, url, sum, sourceUrl);
    expectSame('sections_total', w.sections_total, url, rows.length, sourceUrl);
    // RULE: a section is pending while its register is not FINALIZED (a DRAFT counts as pending).
    const pending = rows
      .filter((r) => r.is_working_day && r.today?.state !== 'FINALIZED')
      .map((r) => r.section_id);
    expectSame(
      'pending sections',
      sortedIds(w.pending_sections.map((s) => s.section_id)),
      url,
      sortedIds(pending),
      sourceUrl,
    );
    expectSame('attendance %', w.percentage, url, attendancePct(sum), sourceUrl);
  });

  test("staff-today = the staff roster plus each staff member's attendance summary", async ({
    request,
  }) => {
    const w = await widget<{
      staff_total: number;
      present: number;
      late: number;
      absent: number;
      leave: number;
      unmarked: number;
      on_leave: unknown[];
    }>(request, 'admin', 'staff-today');
    const users = await allPages<{
      status: string;
      left_at: string | null;
      staff_profile_id: string | null;
    }>(request, 'admin', '/users?status=ACTIVE');
    const staff = users.filter((u) => u.staff_profile_id && !u.left_at);
    const url = '/dashboard/widgets/staff-today';
    expectSame(
      'staff_total',
      w.staff_total,
      url,
      staff.length,
      '/users?status=ACTIVE (staff_profile_id set)',
    );

    const tally = { present: 0, late: 0, absent: 0, leave: 0, working: 0 };
    for (const member of staff) {
      const s = await getJson<{
        working_days: number;
        present_days: number;
        late_days: number;
        absent_days: number;
        leave_days: number;
      }>(
        request,
        'admin',
        `/staff-attendance/summary?staff_profile_id=${member.staff_profile_id}&from=${TODAY}&to=${TODAY}`,
      );
      tally.present += s.present_days;
      tally.late += s.late_days;
      tally.absent += s.absent_days;
      tally.leave += s.leave_days;
      tally.working = Math.max(tally.working, s.working_days);
    }
    const sourceUrl = `/staff-attendance/summary?from=${TODAY}&to=${TODAY} (per staff member)`;
    // RULE: the summary endpoint counts working days only. On a weekly-off day it reads 0
    // although a register may exist, so the day-by-day comparison needs a working day.
    test.skip(tally.working === 0, `${TODAY} is not a working day: the summary reads 0 by rule`);
    expectSame('present', w.present, url, tally.present, sourceUrl);
    expectSame('late', w.late, url, tally.late, sourceUrl);
    expectSame('absent', w.absent, url, tally.absent, sourceUrl);
    // RULE: the widget's `leave` is APPROVED leave records covering today (`on_leave`), a
    // different thing from staff marked LEAVE in the register. So `leave` is checked against
    // its own list, and `unmarked` is staff with no register mark at all (LEAVE marks included).
    expectSame('leave = on_leave list', w.leave, url, w.on_leave.length, url);
    expectSame(
      'unmarked',
      w.unmarked,
      url,
      staff.length - (tally.present + tally.late + tally.absent + tally.leave),
      sourceUrl,
    );
  });

  test('collection-month received = reports totals.net for the month so far', async ({
    request,
  }) => {
    await whileOthersWrite(async () => {
      const w = await widget<{
        received: number;
        last_month_same_point: { received: number };
        last_year_same_point: { as_of: string; received: number } | null;
      }>(request, 'admin', 'collection-month');
      const sourceUrl = reportUrl(MONTH_START, TODAY);
      const report = await getJson<CollectionsReport>(request, 'admin', sourceUrl);
      const url = '/dashboard/widgets/collection-month';
      expectSame('received (applied to bills)', w.received, url, report.totals.net, sourceUrl);
      expectMethodsSumToNet(report, 'month');

      // The comparison points use the same report over the shifted range.
      const [py, pm, pd] = addMonthsIso(MONTH_START, -1).split('-').map(Number);
      const prevTo = `${py}-${String(pm).padStart(2, '0')}-${String(Math.min(Number(TODAY.slice(8)), lastDayOf(py, pm))).padStart(2, '0')}`;
      const prev = await getJson<CollectionsReport>(
        request,
        'admin',
        reportUrl(`${py}-${String(pm).padStart(2, '0')}-${String(pd).padStart(2, '0')}`, prevTo),
      );
      expectSame(
        'last month same point',
        w.last_month_same_point.received,
        url,
        prev.totals.net,
        reportUrl(`${py}-${pm}-01`, prevTo),
      );
    });
  });

  test('mark-entry-progress = GET /exams/:id/marks/progress per class', async ({ request }) => {
    const w = await widget<{
      overall: { submitted: number; total: number };
      classes: { class_name: string; exam_id: string; submitted: number; total: number }[];
    }>(request, 'admin', 'mark-entry-progress');
    expect(w.classes.length).toBeGreaterThan(0);
    let submitted = 0;
    let total = 0;
    for (const c of w.classes) {
      const sourceUrl = `/exams/${c.exam_id}/marks/progress`;
      const p = await getJson<{ counts: { DRAFT: number; SUBMITTED: number } }>(
        request,
        'admin',
        sourceUrl,
      );
      expectSame(
        `${c.class_name} submitted/total`,
        [c.submitted, c.total],
        '/dashboard/widgets/mark-entry-progress',
        [p.counts.SUBMITTED, p.counts.SUBMITTED + p.counts.DRAFT],
        sourceUrl,
      );
      submitted += p.counts.SUBMITTED;
      total += p.counts.SUBMITTED + p.counts.DRAFT;
    }
    expectSame(
      'overall submitted/total',
      [w.overall.submitted, w.overall.total],
      '/dashboard/widgets/mark-entry-progress',
      [submitted, total],
      '/exams/:id/marks/progress (Σ classes)',
    );
  });

  test('syllabus-progress = GET /syllabus-topics per class', async ({ request }) => {
    const w = await widget<{
      overall: { done: number; total: number };
      classes: {
        class_id: string;
        class_name: string;
        done: number;
        in_progress: number;
        total: number;
      }[];
    }>(request, 'admin', 'syllabus-progress');
    expect(w.classes.length).toBeGreaterThan(0);
    let done = 0;
    let total = 0;
    for (const c of w.classes) {
      const sourceUrl = `/syllabus-topics?class_id=${c.class_id}`;
      const topics = await getJson<{ status: string }[]>(request, 'admin', sourceUrl);
      const fromTopics = {
        done: topics.filter((x) => x.status === 'DONE').length,
        in_progress: topics.filter((x) => x.status === 'IN_PROGRESS').length,
        total: topics.length,
      };
      expectSame(
        `${c.class_name} done/in_progress/total`,
        { done: c.done, in_progress: c.in_progress, total: c.total },
        '/dashboard/widgets/syllabus-progress',
        fromTopics,
        sourceUrl,
      );
      done += fromTopics.done;
      total += fromTopics.total;
    }
    expectSame(
      'overall done/total',
      [w.overall.done, w.overall.total],
      '/dashboard/widgets/syllabus-progress',
      [done, total],
      '/syllabus-topics (Σ classes)',
    );
  });

  test('sms-balance = GET /communications/sms-credits', async ({ request }) => {
    const w = await widget<{ metering: string; available: number; reserved: number }>(
      request,
      'admin',
      'sms-balance',
    );
    const sourceUrl = '/communications/sms-credits';
    const s = await getJson<{ metering: string; available: number; reserved: number }>(
      request,
      'admin',
      sourceUrl,
    );
    expectSame(
      'sms balance',
      { metering: w.metering, available: w.available, reserved: w.reserved },
      '/dashboard/widgets/sms-balance',
      { metering: s.metering, available: s.available, reserved: s.reserved },
      sourceUrl,
    );
  });

  test('failed-messages = SMS logs with status FAILED in the last 7 days', async ({ request }) => {
    const w = await widget<{ failed: number; window: { from: string; to: string } }>(
      request,
      'admin',
      'failed-messages',
    );
    const { tenantId } = await roleSession(request, 'admin');
    // There is no list endpoint with a status filter (only per-student history), so the
    // source is a read-only count on the e2e database with the widget's own predicate.
    const failed = await dbCount(
      `SELECT COUNT(*) AS n FROM communication_logs
        WHERE tenant_id = $1 AND medium = 'SMS' AND status = 'FAILED'
          AND created_at >= ($2::date::timestamp AT TIME ZONE 'Asia/Dhaka')`,
      [tenantId, w.window.from],
    );
    expectSame(
      'failed in window',
      w.failed,
      `/dashboard/widgets/failed-messages window ${w.window.from}..${w.window.to}`,
      failed,
      'SELECT count(*) FROM communication_logs (SMS, FAILED)',
    );
    expectSame(
      'window.to is today',
      w.window.to,
      '/dashboard/widgets/failed-messages',
      TODAY,
      'Asia/Dhaka today',
    );
  });

  test('recent-activity = the newest rows of GET /audit-logs', async ({ request }) => {
    // Log in every role first: a login writes an audit row, and the widget is cached 60 s.
    for (const role of [
      'admin',
      'accountant',
      'teacher',
      'office_staff',
      'exam_controller',
      'committee',
    ] as const) {
      await roleSession(request, role);
    }
    const w = await widget<{ items: { id: string }[] }>(request, 'admin', 'recent-activity');
    // 100, not 8: other workers write audit rows all the time, and in 60 s more than 8 can land
    // above the cached widget.
    const sourceUrl = '/audit-logs?page=1&limit=100';
    const source = await getJson<{ data: { id: string }[] }>(request, 'admin', sourceUrl);
    const widgetIds = w.items.map((i) => i.id);
    const sourceIds = source.data.map((i) => i.id);
    // RULE: the widget is cached for 60 s, so rows written after it was cached sit above it in
    // the source. The widget must be an unbroken slice of the newest rows, in the same order.
    const offset = sourceIds.indexOf(widgetIds[0]);
    expect(
      offset,
      `recent-activity: first widget row not in source ${JSON.stringify(sourceIds)}`,
    ).toBeGreaterThanOrEqual(0);
    expectSame(
      'recent-activity ids',
      widgetIds,
      '/dashboard/widgets/recent-activity',
      sourceIds.slice(offset, offset + widgetIds.length),
      sourceUrl,
    );
  });

  test('at-risk-students: each listed student really has at least two signals', async ({
    request,
  }) => {
    await expect
      .poll(
        async () => (await widget<{ state: string }>(request, 'admin', 'at-risk-students')).state,
        {
          timeout: 30_000,
        },
      )
      .toBe('READY');
    const w = await widget<{
      students: {
        student_id: string;
        full_name: string;
        signals: { kind: string; value: number }[];
      }[];
    }>(request, 'admin', 'at-risk-students');
    expect(w.students.length).toBeGreaterThan(0);
    const dues = await allPages<{ student_id: string; total_due: number; months_overdue: number }>(
      request,
      'admin',
      '/fees/dues',
    );
    for (const student of w.students.slice(0, 3)) {
      // RULE (D7): at-risk is computed, it has no source page. The only claim is >= 2 signals;
      // the OVERDUE signal is cross-checked against the dues list.
      expect(student.signals.length, `${student.full_name} signals`).toBeGreaterThanOrEqual(2);
      if (student.signals.some((s) => s.kind === 'OVERDUE')) {
        const due = dues.find((d) => d.student_id === student.student_id);
        expect(
          due,
          `${student.full_name} has an OVERDUE signal but no row in /fees/dues`,
        ).toBeDefined();
        expect(due!.total_due).toBeGreaterThan(0);
      }
    }
  });
});

// ---------------------------------------------------------------------------------------
// ACCOUNTANT
// ---------------------------------------------------------------------------------------

test.describe('dashboard reconciliation: accountant', () => {
  test('collection-today = reports totals.net for today; groups and methods add up', async ({
    request,
  }) => {
    await whileOthersWrite(async () => {
      const w = await widget<{
        net: number;
        groups: {
          group: string;
          net: number;
          methods: { payment_method: string; net: number }[];
        }[];
      }>(request, 'accountant', 'collection-today');
      const sourceUrl = reportUrl(TODAY, TODAY);
      const report = await getJson<CollectionsReport>(request, 'accountant', sourceUrl);
      const url = '/dashboard/widgets/collection-today';
      // RULE: the widget stops at "now", the report at the end of the day; a payment dated later
      // today would be in the report only. The seed has none, so the two are equal.
      expectSame('net', w.net, url, report.totals.net, sourceUrl);
      expectSame(
        'Σ group nets = net',
        round2(w.groups.reduce((n, g) => n + g.net, 0)),
        url,
        w.net,
        url,
      );
      expectMethodsSumToNet(report, 'today');
    });
  });

  test('collection-by-month = reports totals.net for each month', async ({ request }) => {
    await whileOthersWrite(async () => {
      const w = await widget<{
        year: number;
        year_to_date_net: number;
        month_to_date_net: number;
        previous_month_same_days_net: number;
        months: { month: number; net: number | null; is_current: boolean }[];
      }>(request, 'accountant', 'collection-by-month');
      const url = '/dashboard/widgets/collection-by-month';
      const currentMonth = Number(TODAY.slice(5, 7));
      let ytd = 0;
      for (const m of w.months) {
        if (m.month > currentMonth) {
          expectSame(
            `month ${m.month} is in the future`,
            m.net,
            url,
            null,
            'future months are null by rule',
          );
          continue;
        }
        const from = `${w.year}-${String(m.month).padStart(2, '0')}-01`;
        const to = m.is_current
          ? TODAY
          : `${w.year}-${String(m.month).padStart(2, '0')}-${lastDayOf(w.year, m.month)}`;
        const report = await getJson<CollectionsReport>(request, 'accountant', reportUrl(from, to));
        expectSame(`month ${m.month}`, m.net, url, report.totals.net, reportUrl(from, to));
        ytd += round2(report.totals.net); // the server sums rounded months
      }
      expectSame(
        'year_to_date_net',
        w.year_to_date_net,
        url,
        round2(ytd),
        '/reports/collections (Σ months)',
      );
      expectSame(
        'month_to_date_net',
        w.month_to_date_net,
        url,
        w.months[currentMonth - 1].net,
        url,
      );

      const [py, pm] = addMonthsIso(MONTH_START, -1).split('-').map(Number);
      const prevTo = `${py}-${String(pm).padStart(2, '0')}-${String(Math.min(Number(TODAY.slice(8)), lastDayOf(py, pm))).padStart(2, '0')}`;
      const prev = await getJson<CollectionsReport>(
        request,
        'accountant',
        reportUrl(`${py}-${String(pm).padStart(2, '0')}-01`, prevTo),
      );
      expectSame(
        'previous_month_same_days_net',
        w.previous_month_same_days_net,
        url,
        prev.totals.net,
        reportUrl(`${py}-${pm}-01`, prevTo),
      );
    });
  });

  test('dues-ageing and dues-by-class = Σ total_due over every page of GET /fees/dues', async ({
    request,
  }) => {
    await whileOthersWrite(async () => {
      const ageing = await widget<{ total_due: number; buckets: { amount: number }[] }>(
        request,
        'accountant',
        'dues-ageing',
      );
      const byClass = await widget<{
        total_due: number;
        classes: { class_id: string; class_name: string; amount: number; student_count: number }[];
      }>(request, 'accountant', 'dues-by-class');
      const sourceUrl = '/fees/dues';
      const total = await sumAllPages(request, 'accountant', sourceUrl, 'total_due');
      expectSame(
        'dues-ageing total_due',
        ageing.total_due,
        '/dashboard/widgets/dues-ageing',
        total,
        sourceUrl,
      );
      expectSame(
        'Σ ageing buckets',
        round2(ageing.buckets.reduce((n, b) => n + b.amount, 0)),
        '/dashboard/widgets/dues-ageing',
        total,
        sourceUrl,
      );
      expectSame(
        'dues-by-class total_due',
        byClass.total_due,
        '/dashboard/widgets/dues-by-class',
        total,
        sourceUrl,
      );
      for (const c of byClass.classes) {
        const classUrl = `/fees/dues?class_id=${c.class_id}`;
        const amount = await sumAllPages(request, 'accountant', classUrl, 'total_due');
        const students = totalOf(
          await getJson(request, 'accountant', `${classUrl}&page=1&limit=1`),
        );
        expectSame(
          `${c.class_name} amount/student_count`,
          [c.amount, c.student_count],
          '/dashboard/widgets/dues-by-class',
          [amount, students],
          classUrl,
        );
      }
    });
  });

  test('reminders-pending = the flagged-dues total (no reminder logs in the seed)', async ({
    request,
  }) => {
    await whileOthersWrite(async () => {
      const w = await widget<{ student_count: number }>(request, 'accountant', 'reminders-pending');
      const sourceUrl = '/fees/dues/flagged';
      const flagged = totalOf(await getJson(request, 'accountant', `${sourceUrl}?page=1&limit=1`));
      // RULE: the widget is the flagged list minus students who already got a non-FAILED
      // reminder since their threshold date. The seed holds none for flagged students, so the
      // two are equal; if the seed ever gains one, this becomes `widget = flagged - reminded`.
      expectSame(
        'student_count',
        w.student_count,
        '/dashboard/widgets/reminders-pending',
        flagged,
        sourceUrl,
      );
    });
  });

  test('recent-payments = GET /payments newest five (non-reversal); total counts SUCCESS only', async ({
    request,
  }) => {
    await whileOthersWrite(async () => {
      const w = await widget<{
        total_of_shown: number;
        items: { payment_id: string; amount: number; payment_status: string }[];
      }>(request, 'accountant', 'recent-payments');
      const sourceUrl = '/payments?page=1&limit=5&is_reversal=false';
      const source = rowsOf(
        await getJson<{ data: { id: string; total_amount: number; payment_status: string }[] }>(
          request,
          'accountant',
          sourceUrl,
        ),
      );
      const url = '/dashboard/widgets/recent-payments';
      expectSame(
        'payment ids',
        w.items.map((i) => i.payment_id),
        url,
        source.map((p) => p.id),
        sourceUrl,
      );
      expectSame(
        'amounts',
        w.items.map((i) => i.amount),
        url,
        source.map((p) => Number(p.total_amount)),
        sourceUrl,
      );
      // RULE: total_of_shown counts SUCCESS rows only (a PENDING/FAILED row is listed, not summed).
      expectSame(
        'total_of_shown',
        w.total_of_shown,
        url,
        round2(
          source
            .filter((p) => p.payment_status === 'SUCCESS')
            .reduce((n, p) => n + Number(p.total_amount), 0),
        ),
        sourceUrl,
      );
    });
  });
});

// ---------------------------------------------------------------------------------------
// TEACHER
// ---------------------------------------------------------------------------------------

test.describe('dashboard reconciliation: teacher', () => {
  test('my-pending-sections = GET /attendance/my-sections for today', async ({ request }) => {
    const w = await widget<{
      pending_count: number;
      sections: { section_id: string; taken: boolean; student_count: number; unmarked: number }[];
    }>(request, 'teacher', 'my-pending-sections');
    const sourceUrl = `/attendance/my-sections?date=${TODAY}`;
    const rows = await getJson<
      {
        section_id: string;
        student_count: number;
        today: { state: string; unmarked: number } | null;
      }[]
    >(request, 'teacher', sourceUrl);
    const url = '/dashboard/widgets/my-pending-sections';
    expectSame(
      'section ids',
      sortedIds(w.sections.map((s) => s.section_id)),
      url,
      sortedIds(rows.map((r) => r.section_id)),
      sourceUrl,
    );
    // RULE: "taken" means FINALIZED. A DRAFT register is on the register screen but still pending.
    expectSame(
      'taken flags',
      w.sections.map((s) => [s.section_id, s.taken]).sort(),
      url,
      rows.map((r) => [r.section_id, r.today?.state === 'FINALIZED']).sort(),
      sourceUrl,
    );
    expectSame(
      'pending_count',
      w.pending_count,
      url,
      rows.filter((r) => r.today?.state !== 'FINALIZED').length,
      sourceUrl,
    );
  });

  test('my-routine-today = GET /routines/resolve for today', async ({ request }) => {
    const w = await widget<{
      periods: { starts_at: string; section_id: string; cancelled: boolean }[];
    }>(request, 'teacher', 'my-routine-today');
    const teachers = await allPages<{ id: string; user: { email: string } }>(
      request,
      'admin',
      '/teachers',
    );
    const own = teachers.find((x) => x.user.email === 'teacher@biddaloy.test');
    expect(own, 'the seeded teacher has a teacher row').toBeDefined();
    const sourceUrl = `/routines/resolve?teacher_id=${own!.id}&from=${TODAY}&to=${TODAY}`;
    const slots = await getJson<
      { date: string; starts_at: string; section_id: string; cancelled: boolean }[]
    >(request, 'teacher', sourceUrl);
    const hhmm = (s: string) => s.slice(0, 5);
    expectSame(
      'periods',
      w.periods.map((p) => [p.starts_at, p.section_id, p.cancelled]),
      '/dashboard/widgets/my-routine-today',
      slots
        .filter((s) => s.date === TODAY)
        .sort((a, b) => a.starts_at.localeCompare(b.starts_at))
        .map((s) => [hhmm(s.starts_at), s.section_id, s.cancelled]),
      sourceUrl,
    );
  });

  test('my-leave-balance = GET /leave/balance for the caller', async ({ request }) => {
    const w = await widget<{
      by_type: unknown[];
      total_quota_days: number;
      total_used_days: number;
      total_balance_days: number;
    }>(request, 'teacher', 'my-leave-balance');
    const users = await allPages<{ email: string; staff_profile_id: string | null }>(
      request,
      'admin',
      '/users',
    );
    const profile = users.find((u) => u.email === 'teacher@biddaloy.test')?.staff_profile_id;
    expect(profile, 'the seeded teacher has a staff profile').toBeTruthy();
    const sourceUrl = `/leave/balance?staff_profile_id=${profile}`;
    const balances = await getJson<
      { annual_quota_days: number | null; used_days: number; balance: number | null }[]
    >(request, 'teacher', sourceUrl);
    expectSame('by_type', w.by_type, '/dashboard/widgets/my-leave-balance', balances, sourceUrl);
    const sum = (f: (b: (typeof balances)[number]) => number | null) =>
      balances.reduce((n, b) => n + (f(b) ?? 0), 0);
    expectSame(
      'totals',
      [w.total_quota_days, w.total_used_days, w.total_balance_days],
      '/dashboard/widgets/my-leave-balance',
      [sum((b) => b.annual_quota_days), sum((b) => b.used_days), sum((b) => b.balance)],
      sourceUrl,
    );
  });

  test('homework-to-check = SUBMITTED rows of GET /homework-assignments/:id/submissions', async ({
    request,
  }) => {
    const w = await widget<{
      total_submitted: number;
      assignment_count: number;
      items: { assignment_id: string; title: string; submitted_count: number }[];
    }>(request, 'teacher', 'homework-to-check');
    expect(w.items.length).toBeGreaterThan(0);
    let total = 0;
    for (const item of w.items) {
      const sourceUrl = `/homework-assignments/${item.assignment_id}/submissions`;
      const rows = await getJson<{ status: string }[]>(request, 'teacher', sourceUrl);
      const submitted = rows.filter((r) => r.status === 'SUBMITTED').length;
      expectSame(
        `${item.title} submitted_count`,
        item.submitted_count,
        '/dashboard/widgets/homework-to-check',
        submitted,
        sourceUrl,
      );
      total += submitted;
    }
    // RULE: the card shows the top 5 assignments but totals all of them, so the sum of the
    // shown rows equals the total only while every assignment fits in the list.
    if (w.assignment_count <= w.items.length) {
      expectSame(
        'total_submitted',
        w.total_submitted,
        '/dashboard/widgets/homework-to-check',
        total,
        '/homework-assignments/:id/submissions (Σ)',
      );
    } else {
      expect(w.total_submitted).toBeGreaterThanOrEqual(total);
    }
  });

  test('my-syllabus-progress = GET /syllabus-topics per class and subject', async ({ request }) => {
    const w = await widget<{
      items: {
        class_id: string;
        subject_id: string;
        subject_name_en: string;
        done: number;
        total: number;
      }[];
    }>(request, 'teacher', 'my-syllabus-progress');
    expect(w.items.length).toBeGreaterThan(0);
    for (const item of w.items) {
      const sourceUrl = `/syllabus-topics?class_id=${item.class_id}&subject_id=${item.subject_id}`;
      const topics = await getJson<{ status: string }[]>(request, 'teacher', sourceUrl);
      expectSame(
        `${item.subject_name_en} done/total`,
        [item.done, item.total],
        '/dashboard/widgets/my-syllabus-progress',
        [topics.filter((x) => x.status === 'DONE').length, topics.length],
        sourceUrl,
      );
    }
  });
});

// ---------------------------------------------------------------------------------------
// COMMITTEE (compared as ADMIN: COMMITTEE cannot read the source endpoints, by design)
// ---------------------------------------------------------------------------------------

test.describe('dashboard reconciliation: committee', () => {
  test('committee-enrollment current_count = academic-year stats students_count', async ({
    request,
  }) => {
    await whileOthersWrite(async () => {
      const w = await widget<{ current_count: number; years: { student_count: number }[] }>(
        request,
        'admin',
        'committee-enrollment',
      );
      const years = await getJson<{ data: { id: string; is_current: boolean }[] }>(
        request,
        'admin',
        '/academic-years',
      );
      const current = years.data.find((y) => y.is_current);
      expect(current, 'a current academic year').toBeDefined();
      const sourceUrl = `/academic-years/${current!.id}/stats`;
      const stats = await getJson<{ students_count: number }>(request, 'admin', sourceUrl);
      // RULE: the widget counts ACTIVE and GRADUATED enrolments of the year; the stats endpoint
      // counts ACTIVE only. So widget = stats + students graduated in this year.
      const graduated = totalOf(
        await getJson(request, 'admin', '/students?enrollment_status=GRADUATED&page=1&limit=1'),
      );
      expectSame(
        'current_count',
        w.current_count,
        '/dashboard/widgets/committee-enrollment',
        stats.students_count + graduated,
        `${sourceUrl} + /students?enrollment_status=GRADUATED (${stats.students_count} + ${graduated})`,
      );
      expectSame(
        'last year entry is current_count',
        w.years.at(-1)?.student_count,
        '/dashboard/widgets/committee-enrollment',
        w.current_count,
        'same body',
      );
    });
  });

  test('committee-finance current_month = collection-month = reports; year outstanding = open dues', async ({
    request,
  }) => {
    await whileOthersWrite(async () => {
      const w = await widget<{ current_month: unknown; year_outstanding: number }>(
        request,
        'admin',
        'committee-finance',
      );
      const month = await widget<{ received: number }>(request, 'admin', 'collection-month');
      expectSame(
        'current_month',
        w.current_month,
        '/dashboard/widgets/committee-finance',
        month,
        '/dashboard/widgets/collection-month',
      );
      const report = await getJson<CollectionsReport>(
        request,
        'admin',
        reportUrl(MONTH_START, TODAY),
      );
      expectSame(
        'current_month.received',
        month.received,
        '/dashboard/widgets/collection-month',
        report.totals.net,
        reportUrl(MONTH_START, TODAY),
      );
      const dues = await sumAllPages(request, 'admin', '/fees/dues', 'total_due');
      // RULE: year_outstanding is billed minus paid for the current academic year's months up to
      // today, so it equals the open dues only while no open bill falls outside that window.
      expectSame(
        'year_outstanding',
        w.year_outstanding,
        '/dashboard/widgets/committee-finance',
        dues,
        '/fees/dues (Σ total_due)',
      );
    });
  });

  test('committee-pass-rate = GET /exams/:id/analysis/pass-fail per class', async ({ request }) => {
    const w = await widget<{
      exam_name: string | null;
      classes: { class_name: string; pass_percentage: number }[];
      overall_pass_percentage: number | null;
    }>(request, 'admin', 'committee-pass-rate');
    expect(w.exam_name).not.toBeNull();
    const exams = await allPages<{
      id: string;
      name: string;
      status: string;
      class: { name: string };
    }>(request, 'admin', '/exams');
    for (const c of w.classes) {
      // RULE: one bar per class name. The seed has two "Class 8" classes (Day, and Morning
      // English), so a bar sums every same-named class's exam of the round.
      const sources = exams.filter(
        (e) => e.name === w.exam_name && e.status === 'PUBLISHED' && e.class.name === c.class_name,
      );
      expect(sources.length, `published exam "${w.exam_name}" for ${c.class_name}`).toBeGreaterThan(
        0,
      );
      let appeared = 0;
      let passed = 0;
      for (const exam of sources) {
        const pf = await getJson<{ overall: { appeared: number; passed: number } }>(
          request,
          'admin',
          `/exams/${exam.id}/analysis/pass-fail`,
        );
        appeared += pf.overall.appeared;
        passed += pf.overall.passed;
      }
      expectSame(
        `${c.class_name} pass %`,
        c.pass_percentage,
        '/dashboard/widgets/committee-pass-rate',
        // Same rounding as the service (pct1).
        appeared > 0 ? Math.round((passed / appeared) * 1000) / 10 : 0,
        `/exams/:id/analysis/pass-fail (Σ over ${sources.length} "${c.class_name}" exam(s))`,
      );
    }
  });

  test('committee-attendance past months = Σ section attendance summaries', async ({ request }) => {
    const w = await widget<{ months: { month: string; percentage: number | null }[] }>(
      request,
      'admin',
      'committee-attendance',
    );
    // Source: the per-section summary (per-student counts) summed over every section. There is no
    // school-wide attendance endpoint, so this is the closest page. RULE: the dashboard counts
    // FINALIZED registers only; the summary also counts DRAFT ones, so the comparison is limited
    // to months that are over (today's DRAFT register cannot be in them).
    const sections = await getJson<{ section_id: string }[]>(
      request,
      'admin',
      `/attendance/my-sections?date=${TODAY}`,
    );
    const past = w.months
      .filter((m) => m.percentage !== null && m.month < TODAY.slice(0, 7))
      .slice(-2);
    expect(past.length, 'at least one finished month with attendance in the seed').toBeGreaterThan(
      0,
    );
    for (const m of past) {
      const [y, mo] = m.month.split('-').map(Number);
      const from = `${m.month}-01`;
      const to = `${m.month}-${lastDayOf(y, mo)}`;
      const tally: Counts = { present: 0, late: 0, absent: 0, leave: 0 };
      for (const s of sections) {
        const sum = await getJson<{
          students: {
            present_days: number;
            late_days: number;
            absent_days: number;
            leave_days: number;
          }[];
        }>(request, 'admin', `/attendance/sections/${s.section_id}/summary?from=${from}&to=${to}`);
        for (const st of sum.students) {
          tally.present += st.present_days;
          tally.late += st.late_days;
          tally.absent += st.absent_days;
          tally.leave += st.leave_days;
        }
      }
      expectSame(
        `${m.month} attendance %`,
        m.percentage,
        '/dashboard/widgets/committee-attendance',
        attendancePct(tally),
        `/attendance/sections/:id/summary?from=${from}&to=${to} (Σ sections)`,
      );
    }
  });

  test('COMMITTEE sees the identical body for every committee widget', async ({ request }) => {
    for (const key of [
      'committee-enrollment',
      'committee-attendance',
      'committee-finance',
      'committee-pass-rate',
    ]) {
      const asCommittee = await widget(request, 'committee', key);
      const asAdmin = await widget(request, 'admin', key);
      expectSame(
        key,
        asCommittee,
        `/dashboard/widgets/${key} as COMMITTEE`,
        asAdmin,
        `/dashboard/widgets/${key} as ADMIN`,
      );
    }
  });
});

// ---------------------------------------------------------------------------------------
// EXAM CONTROLLER
// ---------------------------------------------------------------------------------------

test.describe('dashboard reconciliation: exam controller', () => {
  test('results-state = GET /exams statuses of the current year, per round', async ({
    request,
  }) => {
    const w = await widget<{
      draft: number;
      processed: number;
      published: number;
      rounds: {
        exam_name: string;
        class_count: number;
        draft: number;
        processed: number;
        published: number;
      }[];
    }>(request, 'exam_controller', 'results-state');
    const years = await getJson<{ data: { id: string; is_current: boolean }[] }>(
      request,
      'admin',
      '/academic-years',
    );
    const current = years.data.find((y) => y.is_current)!;
    const sourceUrl = `/exams?academic_year_id=${current.id}`;
    const exams = await allPages<{ name: string; status: string; class_id: string }>(
      request,
      'exam_controller',
      sourceUrl,
    );
    const url = '/dashboard/widgets/results-state';
    for (const round of w.rounds) {
      const mine = exams.filter((e) => e.name === round.exam_name);
      expectSame(
        `${round.exam_name} class/draft/processed/published`,
        [round.class_count, round.draft, round.processed, round.published],
        url,
        [
          new Set(mine.map((e) => e.class_id)).size,
          mine.filter((e) => e.status === 'DRAFT').length,
          mine.filter((e) => e.status === 'PROCESSED').length,
          mine.filter((e) => e.status === 'PUBLISHED').length,
        ],
        sourceUrl,
      );
    }
    // RULE: the card lists at most 10 rounds and totals only those, so the totals equal the
    // exam list while the year has <= 10 rounds.
    const rounds = new Set(exams.map((e) => e.name));
    if (rounds.size <= 10) {
      expectSame(
        'totals',
        [w.draft, w.processed, w.published],
        url,
        ['DRAFT', 'PROCESSED', 'PUBLISHED'].map((s) => exams.filter((e) => e.status === s).length),
        sourceUrl,
      );
    }
  });

  test('seat-plan-status = GET /seat-plans per exam', async ({ request }) => {
    const w = await widget<{
      exams: {
        exam_id: string;
        exam_name: string;
        planned_count: number;
        published_count: number;
      }[];
    }>(request, 'exam_controller', 'seat-plan-status');
    expect(w.exams.length).toBeGreaterThan(0);
    for (const exam of w.exams) {
      const sourceUrl = `/seat-plans?exam_id=${exam.exam_id}`;
      const plans = await getJson<{ status: string; schedule_count: number }[]>(
        request,
        'exam_controller',
        sourceUrl,
      );
      // RULE: counts are sittings (exam schedules) covered by a plan, not plans. This sums
      // each plan's schedule_count, which is exact while no sitting is in two plans.
      const sum = (rows: typeof plans) => rows.reduce((n, p) => n + p.schedule_count, 0);
      expectSame(
        `${exam.exam_name} planned/published`,
        [exam.planned_count, exam.published_count],
        '/dashboard/widgets/seat-plan-status',
        [sum(plans), sum(plans.filter((p) => p.status === 'PUBLISHED'))],
        sourceUrl,
      );
    }
  });
});

// ---------------------------------------------------------------------------------------
// OFFICE STAFF
// ---------------------------------------------------------------------------------------

test.describe('dashboard reconciliation: office staff', () => {
  test('admissions-today = GET /admission/applicants', async ({ request }) => {
    await whileOthersWrite(async () => {
      const w = await widget<{
        new_today: number;
        pending_total: number;
        latest: { id: string }[];
      }>(request, 'office_staff', 'admissions-today');
      const sourceUrl = '/admission/applicants';
      const all = await getJson<{ id: string; status: string; created_at: string }[]>(
        request,
        'office_staff',
        sourceUrl,
      );
      const pending = await getJson<{ id: string }[]>(
        request,
        'office_staff',
        `${sourceUrl}?status=PENDING`,
      );
      const url = '/dashboard/widgets/admissions-today';
      expectSame(
        'pending_total',
        w.pending_total,
        url,
        pending.length,
        `${sourceUrl}?status=PENDING`,
      );
      expectSame(
        'new_today',
        w.new_today,
        url,
        all.filter((a) => dhakaDay(new Date(a.created_at)) === TODAY).length,
        sourceUrl,
      );
      const newest = [...all].sort((a, b) => b.created_at.localeCompare(a.created_at)).slice(0, 5);
      expectSame(
        'latest ids',
        sortedIds(w.latest.map((l) => l.id)),
        url,
        sortedIds(newest.map((a) => a.id)),
        sourceUrl,
      );
    });
  });

  test('guardians-incomplete = GET /guardians totals', async ({ request }) => {
    await whileOthersWrite(async () => {
      const w = await widget<{ incomplete_count: number; total_count: number }>(
        request,
        'office_staff',
        'guardians-incomplete',
      );
      const incompleteUrl = '/guardians?incomplete=true&page=1&limit=1';
      const incomplete = totalOf(await getJson(request, 'office_staff', incompleteUrl));
      const all = totalOf(await getJson(request, 'office_staff', '/guardians?page=1&limit=1'));
      expectSame(
        'incomplete/total',
        [w.incomplete_count, w.total_count],
        '/dashboard/widgets/guardians-incomplete',
        [incomplete, all],
        `${incompleteUrl} and /guardians`,
      );
    });
  });

  test('students-added-today = GET /students created today', async ({ request }) => {
    await whileOthersWrite(async () => {
      const w = await widget<{ added_today: number; as_of: string }>(
        request,
        'office_staff',
        'students-added-today',
      );
      const sourceUrl = '/students?sort=created_at&order=desc';
      const students = await allPages<{ created_at: string }>(request, 'office_staff', sourceUrl);
      expectSame(
        'added_today',
        w.added_today,
        '/dashboard/widgets/students-added-today',
        students.filter((s) => dhakaDay(new Date(s.created_at)) === TODAY).length,
        sourceUrl,
      );
    });
  });

  test('approvals-pending = the applications inbox (view=inbox) as ADMIN', async ({ request }) => {
    await whileOthersWrite(async () => {
      const w = await widget<{
        total: number;
        by_type: { type: string; count: number }[];
        oldest_pending_at: string | null;
      }>(request, 'admin', 'approvals-pending');
      const sourceUrl = '/applications?view=inbox';
      const rows = await allPages<{ type: string; created_at: string }>(
        request,
        'admin',
        sourceUrl,
      );
      const url = '/dashboard/widgets/approvals-pending';
      expectSame('total', w.total, url, rows.length, sourceUrl);
      expectSame(
        'total vs the list envelope',
        w.total,
        url,
        totalOf(await getJson(request, 'admin', `${sourceUrl}&page=1&limit=1`)),
        `${sourceUrl}&page=1&limit=1`,
      );
      const byType = new Map<string, number>();
      for (const r of rows) byType.set(r.type, (byType.get(r.type) ?? 0) + 1);
      const pairs = (p: [string, number][]) => p.sort((a, b) => a[0].localeCompare(b[0]));
      expectSame(
        'by_type',
        pairs(w.by_type.map((b) => [b.type, b.count])),
        url,
        pairs([...byType]),
        sourceUrl,
      );
      // RULE: the seed adds 5 pending staff leaves and 2 pending fee waivers, but the inbox hides
      // the admin's OWN leave (applyInbox), so the seed contributes at least 4 + 2.
      expect(w.total, 'the seed adds pending applications').toBeGreaterThanOrEqual(6);
      // RULE: oldest_pending_at = MIN(created_at) over the pending inbox rows.
      expectSame(
        'oldest_pending_at',
        w.oldest_pending_at && new Date(w.oldest_pending_at).getTime(),
        url,
        Math.min(...rows.map((r) => new Date(r.created_at).getTime())),
        sourceUrl,
      );
    });
  });

  test('print-queue = GET /print-history/queue as ADMIN', async ({ request }) => {
    await whileOthersWrite(async () => {
      const w = await widget<{ total: number; by_kind: { kind: string; count: number }[] }>(
        request,
        'admin',
        'print-queue',
      );
      const sourceUrl = '/print-history/queue';
      const q = await getJson<{ total: number; by_kind: { kind: string; count: number }[] }>(
        request,
        'admin',
        sourceUrl,
      );
      const url = '/dashboard/widgets/print-queue';
      expectSame('total', w.total, url, q.total, sourceUrl);
      expectSame('by_kind', w.by_kind, url, q.by_kind, sourceUrl);
      expectSame(
        'total = sum of by_kind',
        w.total,
        url,
        w.by_kind.reduce((n, k) => n + k.count, 0),
        'by_kind of the widget',
      );
    });
  });

  test('syllabus-vs-plan = syllabus-progress for the classes that have a plan', async ({
    request,
  }) => {
    const vs = await widget<{
      behind_count: number;
      classes: {
        class_id: string;
        done_percentage: number;
        expected_percentage: number | null;
        behind_by: number;
      }[];
    }>(request, 'admin', 'syllabus-vs-plan');
    const sp = await widget<{
      classes: { class_id: string; percentage: number; expected_percentage: number | null }[];
    }>(request, 'admin', 'syllabus-progress');
    const url = '/dashboard/widgets/syllabus-vs-plan';
    const sourceUrl = '/dashboard/widgets/syllabus-progress';
    // RULE: syllabus-vs-plan lists only classes with a live plan, i.e. where
    // syllabus-progress has a non-null expected_percentage.
    const withPlan = sp.classes.filter((c) => c.expected_percentage !== null);
    expectSame(
      'class ids',
      sortedIds(vs.classes.map((c) => c.class_id)),
      url,
      sortedIds(withPlan.map((c) => c.class_id)),
      sourceUrl,
    );
    expectSame(
      'done/expected per class',
      vs.classes.map((c) => [c.class_id, c.done_percentage, c.expected_percentage]).sort(),
      url,
      withPlan.map((c) => [c.class_id, c.percentage, c.expected_percentage]).sort(),
      sourceUrl,
    );
    // RULE: behind_by = max(0, expected - done); behind_count counts classes with behind_by > 0.
    for (const c of vs.classes) {
      expect(c.behind_by, `behind_by of ${c.class_id}`).toBe(
        Math.max(0, (c.expected_percentage ?? 0) - c.done_percentage),
      );
    }
    expect(vs.behind_count).toBe(vs.classes.filter((c) => c.behind_by > 0).length);
  });

  // RULE (server lessonsToMark): count UNREPORTED periods of kind ROUTINE in the teacher's plan
  // schedules whose slot is theirs (or that they cover); a substituted period belongs to the
  // substitute only.
  test('my-lessons-to-mark = unreported ROUTINE periods in the teacher plan schedules', async ({
    request,
  }) => {
    const w = await widget<{
      to_mark: number;
      oldest_planned_on: string | null;
      items: unknown[];
    }>(request, 'teacher', 'my-lessons-to-mark');
    const teachers = await allPages<{ id: string; user: { email: string } }>(
      request,
      'admin',
      '/teachers',
    );
    const me = teachers.find((x) => x.user.email === 'teacher@biddaloy.test');
    expect(me, 'the seeded teacher has a teacher row').toBeDefined();
    const slots = await getJson<{ routine_slot_id: string }[]>(
      request,
      'teacher',
      `/routines/resolve?teacher_id=${me!.id}&from=${addDaysIso(TODAY, -28)}&to=${addDaysIso(TODAY, 7)}`,
    );
    const mySlots = new Set(slots.map((s) => s.routine_slot_id));
    const plans = await allPages<{ id: string }>(request, 'teacher', '/study-plans');
    let expected = 0;
    for (const p of plans) {
      const sch = await getJson<{
        periods: {
          status: string;
          kind: string;
          routine_slot_id?: string;
          substitute_teacher_id?: string;
        }[];
      }>(request, 'teacher', `/study-plans/${p.id}/schedule`);
      for (const per of sch.periods) {
        if (per.status !== 'UNREPORTED' || per.kind !== 'ROUTINE') continue;
        const mine = per.substitute_teacher_id
          ? per.substitute_teacher_id === me!.id
          : !!per.routine_slot_id && mySlots.has(per.routine_slot_id);
        if (mine) expected += 1;
      }
    }
    expectSame(
      'to_mark',
      w.to_mark,
      '/dashboard/widgets/my-lessons-to-mark',
      expected,
      `/study-plans/:id/schedule over ${plans.length} plans`,
    );
    expect(w.items.length).toBeLessThanOrEqual(5);
    expect(w.oldest_planned_on === null).toBe(w.to_mark === 0);
  });
});

// ---------------------------------------------------------------------------------------
// UI: the rendered number is the API number (3 office cards)
// ---------------------------------------------------------------------------------------

test.describe('dashboard reconciliation: rendered cards', () => {
  test.use(loggedIn('office_staff'));

  const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  /** The text a count-plural key can render as (the catalog may carry `_one`, `_other` or both). */
  const countText = (key: string, count: number): RegExp => {
    const texts: string[] = [];
    for (const suffix of ['_one', '_other']) {
      try {
        texts.push(t(`${key}${suffix}`, { count }));
      } catch {
        // this locale has no such plural form
      }
    }
    return new RegExp(texts.map(escape).join('|'));
  };

  test('admissions-today, guardians-incomplete and students-added-today show the API numbers', async ({
    page,
    request,
  }) => {
    const office = await apiSession(request, 'office_staff');
    const admissions = await get<{ new_today: number; pending_total: number }>(
      request,
      office,
      '/dashboard/widgets/admissions-today',
    );
    const guardians = await get<{ incomplete_count: number }>(
      request,
      office,
      '/dashboard/widgets/guardians-incomplete',
    );
    const added = await get<{ added_today: number }>(
      request,
      office,
      '/dashboard/widgets/students-added-today',
    );

    await page.goto('/dashboard');
    await expect(
      page.getByRole('heading', { level: 1, name: t('dashboard.page.title') }),
    ).toBeVisible();
    await expect(page.locator('[data-slot="widget-skeleton"]')).toHaveCount(0);
    const card = (key: string) =>
      page.getByRole('region', { name: t(`dashboard.widgets.${key}.title`) });

    const k = (key: string, sub: string) => `dashboard.widgets.${key}.${sub}`;
    await expect(card('admissions-today')).toContainText(
      countText(k('admissions-today', 'value'), admissions.new_today),
    );
    await expect(card('admissions-today')).toContainText(
      countText(k('admissions-today', 'pending'), admissions.pending_total),
    );
    await expect(card('guardians-incomplete')).toContainText(
      countText(k('guardians-incomplete', 'value'), guardians.incomplete_count),
    );
    await expect(card('students-added-today')).toContainText(
      countText(k('students-added-today', 'value'), added.added_today),
    );
  });
});

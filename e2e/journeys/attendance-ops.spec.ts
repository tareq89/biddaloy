import { AttendanceStatus } from '@biddaloy/shared';
import type { APIRequestContext } from '@playwright/test';
import {
  adminApiSession,
  apiSession,
  createStudentsInSection,
  get,
  isFridayAnywhere,
  markableDateIso,
  post,
  put,
  type ApiSession,
} from '../api';
import { expect, loggedIn, test } from '../fixtures/test';
import { t } from '../i18n';
import { AttendancePage } from '../pages';

/**
 * [41.4.7] Attendance operations, end to end: the pending check-list and
 * its dashboard card, the monthly edit grid (save, then a mid-edit
 * conflict), a period register with its prefill notice and the subject
 * report, and the Settings knobs (shift times, the period switch).
 *
 * Serial, one worker: the Settings test flips the tenant's period switch
 * (restored in a `finally`), so nothing else in this file may run beside it.
 * Every date comes from `markableDateIso()` — the SCHOOL's date (Asia/Dhaka),
 * never the runner's clock. Each test sets up its own data (no state is
 * passed between tests), so `--grep`, sharding and retries work.
 *
 * What is left behind: the check-list and month-edit tests use fresh class
 * sections. The period test marks a period on a SEEDED Class 6 section and,
 * when the day has no register yet, adds one with one absentee. Neither can
 * be undone (there is no delete-register endpoint), so it never writes the
 * day register on `MARK_DATE`: `journeys/attendance.spec.ts` owns that one.
 */
test.describe.configure({ mode: 'serial' });

const MARK_DATE = markableDateIso();
const MONTH = MARK_DATE.slice(0, 7);

function addDays(dateIso: string, days: number): string {
  const d = new Date(`${dateIso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** The seeded Class 6 / A, as `session` sees it in `my-sections`. */
async function seededClassSixA(request: APIRequestContext, session: ApiSession) {
  const mine = await get<{ section_id: string; section_name: string; class_name: string }[]>(
    request,
    session,
    '/attendance/my-sections',
  );
  const section = mine.find((s) => s.class_name === 'Class 6' && s.section_name === 'A');
  if (!section) throw new Error('Seeded Class 6 / A not found — has `yarn seed` run?');
  return section;
}

interface Matrix {
  dates: { date: string; is_working_day: boolean }[];
  rows: { student_id: string; roll_number: number; marks: Record<string, string | null> }[];
  versions: Record<string, number | null>;
}

async function matrixOf(
  request: APIRequestContext,
  session: ApiSession,
  sectionId: string,
): Promise<Matrix> {
  return get<Matrix>(
    request,
    session,
    `/attendance/sections/${sectionId}/register-matrix?month=${MONTH}`,
  );
}

/** Day numbers print as Latin or Bangla digits depending on region settings. */
function dayNumberPattern(dateIso: string): RegExp {
  const day = String(Number(dateIso.slice(-2)));
  const bangla = day.replace(/\d/g, (d) => '০১২৩৪৫৬৭৮৯'[Number(d)]!);
  return new RegExp(`(?<![\\d০-৯])(?:${day}|${bangla})(?![\\d০-৯])`);
}

test.describe('check-list', () => {
  test.use(loggedIn('admin'));

  test('admin finalizes a pending section and the pending count drops by one', async ({
    page,
    request,
  }) => {
    const admin = await adminApiSession(request);
    const chain = await createStudentsInSection(request, admin, 'Ops Pending Student', 2);
    const attendance = new AttendancePage(page);

    // Only this test's own row is asserted: other specs running beside this
    // one can move the tenant-wide "N of M pending" count at any time.
    await attendance.gotoPending(MARK_DATE);
    await expect(attendance.sectionLink(chain.className)).toBeVisible();

    await attendance.sectionLink(chain.className).click();
    await expect(
      page.getByText(t('attendance.mark.rollNumber', { roll: 1 })).first(),
    ).toBeVisible();
    await attendance.markAllPresent();
    await attendance.submit();
    await expect(page.getByText(t('attendance.mark.savedToast'))).toBeVisible();

    // Submitting leaves the register a DRAFT, which is still "pending"; the
    // screen has no Finalize button, so the final step goes through the API.
    await attendance.gotoPending(MARK_DATE);
    await expect(attendance.sectionLink(chain.className)).toBeVisible();
    await post(request, admin, `/attendance/sections/${chain.sectionId}/register/finalize`, {
      date: MARK_DATE,
    });

    await attendance.gotoPending(MARK_DATE);
    await expect(attendance.sectionLink(chain.className)).toHaveCount(0);
    // ...and it is listed as done instead.
    await page.goto(`/attendance?status=done&date=${MARK_DATE}`);
    await expect(attendance.sectionLink(chain.className)).toBeVisible();
  });

  test('the dashboard card shows a pending count and links to the filtered list', async ({
    page,
    request,
  }) => {
    test.skip(
      isFridayAnywhere(),
      'the school is closed on Friday: the card shows the holiday text',
    );
    const admin = await adminApiSession(request);
    // A fresh, unmarked section: the card has at least one pending to show.
    const chain = await createStudentsInSection(request, admin, 'Ops Card Student', 2);
    const attendance = new AttendancePage(page);

    await page.goto('/dashboard');
    const card = page
      .getByRole('heading', { level: 2, name: t('attendance.dashboardCard.title') })
      .locator('xpath=ancestor::*[self::div or self::section][1]');
    await expect(card).toBeVisible();
    // The exact numbers are tenant-wide and other specs move them, so only
    // their shape is checked; this test's own section is checked in the list.
    const { pending, total } = await attendance.countsFrom(
      card,
      'attendance.dashboardCard.pending_other',
    );
    expect(pending).toBeGreaterThanOrEqual(1);
    expect(total).toBeGreaterThanOrEqual(pending);

    await card.getByRole('link', { name: t('attendance.dashboardCard.open') }).click();
    await expect(page).toHaveURL(/\/attendance\?.*status=pending/);
    await expect(
      page.getByRole('heading', { level: 1, name: t('attendance.list.title') }),
    ).toBeVisible();
    await expect(attendance.sectionLink(chain.className)).toBeVisible();
  });
});

test.describe('monthly edit', () => {
  test.use(loggedIn('admin'));

  test('edits two cells on two days, saves with a reason, and both hold after a reload', async ({
    page,
    request,
  }) => {
    const admin = await adminApiSession(request);
    const chain = await createStudentsInSection(request, admin, 'Ops Edit Student', 3);
    const attendance = new AttendancePage(page);

    await attendance.gotoRegisterEdit(chain, MONTH);
    const columns = await attendance.editableColumns();
    test.skip(columns.length === 0, 'no open school day yet this month');
    const last = columns.at(-1)!;
    const previous = columns.at(-2) ?? last;
    await attendance.setCellByKey(0, last, 'a');
    await attendance.setCellByKey(1, previous, 'l');
    await expect(
      page.getByText(t('attendance.register.changedCount_other', { count: 2 })),
    ).toBeVisible();

    await page.getByLabel(t('attendance.register.reasonLabel')).fill('Teacher forgot to submit');
    await page.getByRole('button', { name: t('attendance.register.save', { count: 2 }) }).click();
    await expect(page.getByRole('button', { name: t('attendance.register.edit') })).toBeVisible();

    await page.reload();
    await expect(page.getByRole('button', { name: t('attendance.register.edit') })).toBeVisible();

    const matrix = await matrixOf(request, admin, chain.sectionId);
    const lastDate = matrix.dates[last]!.date;
    const previousDate = matrix.dates[previous]!.date;
    const [first, second] = matrix.rows;
    expect(first!.marks[lastDate]).toBe(AttendanceStatus.ABSENT);
    expect(second!.marks[previousDate]).toBe(AttendanceStatus.LATE);

    // ...and the grid itself shows them after a reload.
    await attendance.gotoRegisterEdit(chain, MONTH);
    await expect(attendance.editCell(0, last)).toHaveAttribute(
      'aria-label',
      new RegExp(t('attendance.statusControl.status.ABSENT')),
    );
    await expect(attendance.editCell(1, previous)).toHaveAttribute(
      'aria-label',
      new RegExp(t('attendance.statusControl.status.LATE')),
    );
  });

  test('a day changed through the API mid-edit shows the conflict and saves nothing', async ({
    page,
    request,
  }) => {
    const admin = await adminApiSession(request);
    const chain = await createStudentsInSection(request, admin, 'Ops Conflict Student', 3);
    const attendance = new AttendancePage(page);

    await attendance.gotoRegisterEdit(chain, MONTH);
    const columns = await attendance.editableColumns();
    test.skip(columns.length < 2, 'needs two open school days in the month so far');
    const last = columns.at(-1)!;
    const previous = columns.at(-2);
    await attendance.setCellByKey(0, last, 'a');
    await attendance.setCellByKey(1, previous!, 'a');

    // Someone else registers the LAST day while this admin is still editing.
    const before = await matrixOf(request, admin, chain.sectionId);
    const lastDate = before.dates[last]!.date;
    const previousDate = before.dates[previous!]!.date;
    await put(request, admin, `/attendance/sections/${chain.sectionId}/register`, {
      date: lastDate,
      base_version: 0,
      client_request_id: crypto.randomUUID(),
      entries: [{ student_id: before.rows[2]!.student_id, status: AttendanceStatus.PRESENT }],
    });

    await page.getByLabel(t('attendance.register.reasonLabel')).fill('Teacher forgot to submit');
    await page.getByRole('button', { name: t('attendance.register.save', { count: 2 }) }).click();

    const dialog = page.getByRole('dialog', { name: t('attendance.register.conflictTitle') });
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText(dayNumberPattern(lastDate));

    // All-or-nothing: the OTHER day was not written either.
    const after = await matrixOf(request, admin, chain.sectionId);
    expect(after.rows[0]!.marks[lastDate] ?? null).toBeNull();
    expect(after.rows[1]!.marks[previousDate] ?? null).toBeNull();
  });
});

interface PeriodInfo {
  period_no: number;
  subject_id: string;
  subject_name: string | null;
  state: string | null;
}

interface PeriodRegister {
  students: { student_id: string; roll_number: number; suggested_status: string | null }[];
}

interface OpenPeriod {
  sectionId: string;
  date: string;
  period: PeriodInfo;
  /** The day has no register yet: add one with this absentee first. */
  absentee: string | null;
}

/** A routine period nobody has marked yet, in the correction window, whose
 * roster can open with the prefill notice: the day register already has an
 * absentee, or there is no day register yet and the day is not `MARK_DATE`
 * (so this spec may add one). Tries every seeded Class 6 section the teacher
 * can open, newest day first. The seed marks A's two newest weekly slots, so
 * on a fresh database it is usually B's Monday slot that qualifies. */
async function findOpenPeriod(
  request: APIRequestContext,
  teacher: ApiSession,
  admin: ApiSession,
): Promise<OpenPeriod | null> {
  const mine = await get<{ section_id: string; section_name: string; class_name: string }[]>(
    request,
    teacher,
    '/attendance/my-sections',
  );
  const sectionIds = mine
    .filter((s) => s.class_name === 'Class 6')
    .sort((a, b) => a.section_name.localeCompare(b.section_name))
    .map((s) => s.section_id);
  for (let back = 0; back <= 2; back += 1) {
    const date = addDays(MARK_DATE, -back);
    for (const sectionId of sectionIds) {
      const periods = await get<PeriodInfo[]>(
        request,
        teacher,
        `/attendance/sections/${sectionId}/periods?date=${date}`,
      );
      for (const period of periods.filter((p) => p.state === null)) {
        const probe = await get<PeriodRegister>(
          request,
          teacher,
          `/attendance/sections/${sectionId}/register?date=${date}&period_no=${period.period_no}`,
        );
        if (probe.students.some((s) => s.suggested_status)) {
          return { sectionId, date, period, absentee: null };
        }
        // No prefill yet. Adding a day register is fine, but never on MARK_DATE
        // (journeys/attendance.spec.ts owns Class 6 / A's) and never over a
        // register that already exists.
        if (date === MARK_DATE) continue;
        const day = await get<{
          session: { id: string | null };
          students: { student_id: string }[];
        }>(request, admin, `/attendance/sections/${sectionId}/register?date=${date}`);
        if (day.session.id === null && day.students[0]) {
          return { sectionId, date, period, absentee: day.students[0].student_id };
        }
      }
    }
  }
  return null;
}

test.describe('period attendance', () => {
  test.use(loggedIn('teacher'));

  test('a teacher marks a period with the prefill notice and the subject report counts it', async ({
    page,
    request,
  }) => {
    const teacher = await apiSession(request, 'teacher');
    const admin = await adminApiSession(request);

    const open = await findOpenPeriod(request, teacher, admin);
    test.skip(
      open === null,
      'no unmarked routine period with a prefill in the last 3 school days (seeded routine: Class 6 A and B have a weekly Monday slot)',
    );
    const { sectionId, date, period, absentee } = open!;

    // The prefill needs an absent day mark: add the day register it needs.
    if (absentee !== null) {
      await put(request, admin, `/attendance/sections/${sectionId}/register`, {
        date,
        base_version: 0,
        client_request_id: crypto.randomUUID(),
        entries: [{ student_id: absentee, status: AttendanceStatus.ABSENT }],
      });
    }

    const heldBefore = await subjectHeld(request, admin, sectionId, date, period);

    const attendance = new AttendancePage(page);
    await attendance.gotoSection(sectionId, date);
    await page
      .getByRole('tab', { name: new RegExp(period.subject_name ?? String(period.period_no)) })
      .click();
    await expect(page.getByText(t('attendance.period.prefilledNotice'))).toBeVisible();
    await attendance.markAllPresent();
    await attendance.submit();
    await expect(page.getByText(t('attendance.mark.savedToast'))).toBeVisible();

    const heldAfter = await subjectHeld(request, admin, sectionId, date, period);
    expect(heldAfter).toBe(heldBefore + 1);
  });
});

test.describe('subject report', () => {
  test.use(loggedIn('admin'));

  test('the By-subject tab heads each subject with the periods held', async ({ page, request }) => {
    // Its own data, read from the API: no state from the period test above.
    const admin = await adminApiSession(request);
    const section = await seededClassSixA(request, admin);
    const summary = await subjectSummary(request, admin, section.section_id, MONTH);
    const subject = summary.subjects.find((s) => s.held > 0);
    test.skip(subject === undefined, 'no period register on Class 6 / A this month');
    const { name, held } = subject!;

    await page.goto(
      `/attendance/reports?view=subjects&section_id=${section.section_id}&month=${MONTH}`,
    );
    await expect(
      page.getByRole('tab', { name: t('attendance.reports.viewSubjects') }),
    ).toBeVisible();
    // The column header carries "<subject> (<held>)", digits Latin or Bangla.
    const bangla = String(held).replace(/\d/g, (d) => '০১২৩৪৫৬৭৮৯'[Number(d)]!);
    await expect(page.getByRole('columnheader', { name: new RegExp(name) })).toContainText(
      new RegExp(`\\((?:${held}|${bangla})\\)`),
    );
  });
});

/** `GET .../subject-summary` over one whole month (`YYYY-MM`). */
async function subjectSummary(
  request: APIRequestContext,
  session: ApiSession,
  sectionId: string,
  month: string,
) {
  const last = new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5)), 0));
  return get<{ subjects: { subject_id: string; name: string; held: number }[] }>(
    request,
    session,
    `/attendance/sections/${sectionId}/subject-summary?from=${month}-01&to=${month}-${String(last.getUTCDate()).padStart(2, '0')}`,
  );
}

async function subjectHeld(
  request: APIRequestContext,
  session: ApiSession,
  sectionId: string,
  date: string,
  period: PeriodInfo,
): Promise<number> {
  const summary = await subjectSummary(request, session, sectionId, date.slice(0, 7));
  return summary.subjects.find((s) => s.subject_id === period.subject_id)?.held ?? 0;
}

test.describe('settings', () => {
  test.use(loggedIn('admin'));

  test('shift times hold after a reload; turning the period switch off removes the period tabs', async ({
    page,
    request,
  }) => {
    test.setTimeout(90_000);
    const admin = await adminApiSession(request);
    const settingsPath = `/schools/${admin.tenantId}/settings`;
    const original = await get<{ version: number; attendance?: Record<string, unknown> }>(
      request,
      admin,
      settingsPath,
    );
    const shifts = await get<{ data: { id: string; name: string }[] }>(
      request,
      admin,
      '/routines/shifts',
    );
    const shift = shifts.data[0];
    if (!shift) throw new Error('the demo school has no shift');
    const lateLabel = `${shift.name} — ${t('settings.attendance.shiftLateAfter')}`;
    const absentLabel = `${shift.name} — ${t('settings.attendance.shiftAbsentAfter')}`;

    // A date whose routine has periods (A's weekly Monday slot), so the tabs can be looked for.
    const section = await seededClassSixA(request, admin);
    let periodDate: string | null = null;
    for (let back = 0; back < 28 && periodDate === null; back += 1) {
      const date = addDays(MARK_DATE, -back);
      const periods = await get<unknown[]>(
        request,
        admin,
        `/attendance/sections/${section.section_id}/periods?date=${date}`,
      );
      if (periods.length > 0) periodDate = date;
    }
    expect(periodDate, 'the seeded routine has no period in the last 4 weeks').not.toBeNull();

    try {
      await page.goto('/settings?section=academics');
      const card = page.locator('#attendance-section');
      await expect(card).toBeVisible();

      // Pick two times for the shift: typing filters the list (Latin digits
      // match Bangla ones), Enter takes the first match.
      const late = card.getByRole('combobox', { name: lateLabel });
      await late.fill('9:00');
      await page.keyboard.press('Enter');
      const absent = card.getByRole('combobox', { name: absentLabel });
      await absent.fill('11:30');
      await page.keyboard.press('Enter');
      const lateValue = await late.inputValue();
      const absentValue = await absent.inputValue();
      expect(lateValue).not.toBe('');
      expect(absentValue).not.toBe('');
      await card.getByRole('button', { name: t('settings.save.action') }).click();
      await expect(card.getByText(t('settings.save.success'))).toBeVisible();

      await page.reload();
      await expect(card.getByRole('combobox', { name: lateLabel })).toHaveValue(lateValue);
      await expect(card.getByRole('combobox', { name: absentLabel })).toHaveValue(absentValue);

      // The period tabs are there while the switch is on...
      const tabs = () => page.getByRole('tablist', { name: t('attendance.period.tabsLabel') });
      await page.goto(`/attendance/${section.section_id}?date=${periodDate}`);
      await expect(tabs()).toBeVisible();

      // ...and gone once it is off.
      await page.goto('/settings?section=academics');
      await card.getByLabel(t('settings.attendance.periodEnabled')).uncheck();
      await card.getByRole('button', { name: t('settings.save.action') }).click();
      await expect(card.getByText(t('settings.save.success'))).toBeVisible();
      await page.goto(`/attendance/${section.section_id}?date=${periodDate}`);
      await expect(
        page.getByText(t('attendance.mark.rollNumber', { roll: 1 })).first(),
      ).toBeVisible();
      await expect(tabs()).toHaveCount(0);
    } finally {
      // Put the school back the way the seed left it: switch on, no shift times.
      const { shiftTimes: _ignored, ...rest } = original.attendance ?? {};
      const response = await request.patch(`/api/v1${settingsPath}`, {
        headers: { Authorization: `Bearer ${admin.token}`, 'X-Tenant-ID': admin.tenantId },
        data: {
          version: original.version,
          attendance: { ...rest, periodAttendance: { enabled: true }, shiftTimes: [] },
        },
      });
      expect(response.ok(), `restoring settings failed: ${response.status()}`).toBe(true);
    }
  });
});

import { AttendanceStatus } from '@biddaloy/shared';
import type { APIRequestContext } from '@playwright/test';
import {
  adminApiSession,
  apiSession,
  createStudentsInSection,
  get,
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
 * never the runner's clock; fresh class sections (not the seeded A/B) keep
 * these tests off `journeys/attendance.spec.ts`'s register.
 */
test.describe.configure({ mode: 'serial' });

const MARK_DATE = markableDateIso();
const MONTH = MARK_DATE.slice(0, 7);

function addDays(dateIso: string, days: number): string {
  const d = new Date(`${dateIso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** The school is closed on Friday. The dashboard card and the unfiltered
 * list read "today" from the browser, so a Friday on either clock (the
 * runner's or Dhaka's) turns them into the holiday state. */
function isFridayAnywhere(): boolean {
  const dhaka = new Date(
    `${new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Dhaka' }).format(new Date())}T00:00:00Z`,
  );
  return dhaka.getUTCDay() === 5 || new Date().getDay() === 5;
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

    await attendance.gotoPending(MARK_DATE);
    await expect(attendance.sectionLink(chain.className)).toBeVisible();
    const before = await attendance.pendingCounts();
    // Seeded Class 6 sections plus this fresh one are still to be finalized.
    expect(before.pending).toBeGreaterThanOrEqual(1);

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
    const after = await attendance.pendingCounts();
    expect(after.pending).toBe(before.pending - 1);
  });

  test('the dashboard card shows the list count and links to the filtered list', async ({
    page,
    request,
  }) => {
    test.skip(
      isFridayAnywhere(),
      'the school is closed on Friday: the card shows the holiday text',
    );
    const admin = await adminApiSession(request);
    await createStudentsInSection(request, admin, 'Ops Card Student', 2);
    const attendance = new AttendancePage(page);

    // No `date`: the card and this list both read the browser's "today".
    await attendance.gotoPending();
    const { pending, total } = await attendance.pendingCounts();

    await page.goto('/dashboard');
    const card = page
      .getByRole('heading', { level: 2, name: t('attendance.dashboardCard.title') })
      .locator('xpath=ancestor::*[self::div or self::section][1]');
    await expect(card).toBeVisible();
    // Same numbers as the list (the card and the list read the same endpoint).
    expect(await attendance.countsFrom(card, 'attendance.dashboardCard.pending')).toEqual({
      pending,
      total,
    });

    await card.getByRole('link', { name: t('attendance.dashboardCard.open') }).click();
    await expect(page).toHaveURL(/\/attendance\?.*status=pending/);
    await expect(
      page.getByRole('heading', { level: 1, name: t('attendance.list.title') }),
    ).toBeVisible();
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
    const last = columns.at(-1)!;
    const previous = columns.at(-2);
    test.skip(previous === undefined, 'needs two editable days in the month');
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

/** The newest date in the correction window whose routine has a period
 * nobody has marked yet — the seed marks only the two newest weekly slots,
 * and the routine's weekday decides which days have periods at all. */
async function findOpenPeriod(
  request: APIRequestContext,
  session: ApiSession,
  sectionId: string,
): Promise<{ date: string; period: PeriodInfo } | null> {
  for (let back = 0; back <= 2; back += 1) {
    const date = addDays(MARK_DATE, -back);
    const periods = await get<PeriodInfo[]>(
      request,
      session,
      `/attendance/sections/${sectionId}/periods?date=${date}`,
    );
    const open = periods.find((p) => p.state === null);
    if (open) return { date, period: open };
  }
  return null;
}

let markedPeriod: { sectionId: string; date: string; period: PeriodInfo; held: number } | null =
  null;

test.describe('period attendance', () => {
  test.use(loggedIn('teacher'));

  test('a teacher marks a period with the prefill notice and the subject report counts it', async ({
    page,
    request,
  }) => {
    const teacher = await apiSession(request, 'teacher');
    const admin = await adminApiSession(request);
    const mine = await get<{ section_id: string; section_name: string; class_name: string }[]>(
      request,
      teacher,
      '/attendance/my-sections',
    );
    const section = mine.find((s) => s.class_name === 'Class 6' && s.section_name === 'A');
    if (!section) throw new Error('Seeded Class 6 / A not found — has `yarn seed` run?');

    const open = await findOpenPeriod(request, teacher, section.section_id);
    test.skip(
      open === null,
      'no unmarked routine period in the last 3 school days (seeded routine: A has a weekly Monday slot)',
    );
    const { date, period } = open!;

    // The prefill needs an absent day mark. Write one only if the day has no register yet.
    const probe = await get<PeriodRegister>(
      request,
      teacher,
      `/attendance/sections/${section.section_id}/register?date=${date}&period_no=${period.period_no}`,
    );
    if (!probe.students.some((s) => s.suggested_status)) {
      const day = await get<{ session: { id: string | null }; students: { student_id: string }[] }>(
        request,
        admin,
        `/attendance/sections/${section.section_id}/register?date=${date}`,
      );
      test.skip(
        day.session.id !== null,
        'the day register is already final with no absentee to prefill',
      );
      await put(request, admin, `/attendance/sections/${section.section_id}/register`, {
        date,
        base_version: 0,
        client_request_id: crypto.randomUUID(),
        entries: [{ student_id: day.students[0]!.student_id, status: AttendanceStatus.ABSENT }],
      });
    }

    const heldBefore = await subjectHeld(request, admin, section.section_id, date, period);

    const attendance = new AttendancePage(page);
    await attendance.gotoSection(section.section_id, date);
    await page
      .getByRole('tab', { name: new RegExp(period.subject_name ?? String(period.period_no)) })
      .click();
    await expect(page.getByText(t('attendance.period.prefilledNotice'))).toBeVisible();
    await attendance.markAllPresent();
    await attendance.submit();
    await expect(page.getByText(t('attendance.mark.savedToast'))).toBeVisible();

    const heldAfter = await subjectHeld(request, admin, section.section_id, date, period);
    expect(heldAfter).toBe(heldBefore + 1);
    markedPeriod = { sectionId: section.section_id, date, period, held: heldAfter };
  });
});

test.describe('subject report', () => {
  test.use(loggedIn('admin'));

  test('the By-subject tab shows the period that was just held', async ({ page }) => {
    test.skip(markedPeriod === null, 'the period test above did not run');
    const { sectionId, date, period, held } = markedPeriod!;
    await page.goto(
      `/attendance/reports?view=subjects&section_id=${sectionId}&month=${date.slice(0, 7)}`,
    );
    await expect(
      page.getByRole('tab', { name: t('attendance.reports.viewSubjects') }),
    ).toBeVisible();
    // The column header carries "<subject> (<held>)", digits Latin or Bangla.
    const bangla = String(held).replace(/\d/g, (d) => '০১২৩৪৫৬৭৮৯'[Number(d)]!);
    await expect(
      page.getByRole('columnheader', { name: new RegExp(`${period.subject_name}`) }),
    ).toContainText(new RegExp(`\\((?:${held}|${bangla})\\)`));
  });
});

async function subjectHeld(
  request: APIRequestContext,
  session: ApiSession,
  sectionId: string,
  date: string,
  period: PeriodInfo,
): Promise<number> {
  const month = date.slice(0, 7);
  const last = new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5)), 0));
  const summary = await get<{ subjects: { subject_id: string; held: number }[] }>(
    request,
    session,
    `/attendance/sections/${sectionId}/subject-summary?from=${month}-01&to=${month}-${String(last.getUTCDate()).padStart(2, '0')}`,
  );
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
    const original = await get<{ attendance?: Record<string, unknown> }>(
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
    const mine = await get<{ section_id: string; section_name: string; class_name: string }[]>(
      request,
      admin,
      '/attendance/my-sections',
    );
    const section = mine.find((s) => s.class_name === 'Class 6' && s.section_name === 'A');
    if (!section) throw new Error('Seeded Class 6 / A not found — has `yarn seed` run?');
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
          version: 1,
          attendance: { ...rest, periodAttendance: { enabled: true }, shiftTimes: [] },
        },
      });
      expect(response.ok(), `restoring settings failed: ${response.status()}`).toBe(true);
    }
  });
});

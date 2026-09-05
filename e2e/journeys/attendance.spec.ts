import { AttendanceStatus } from '@biddaloy/shared';
import { ATTENDANCE_SEED_ABSENT_DATE } from '../seed-contract';
import { apiSession, get } from '../api';
import { expect, loggedIn, test } from '../fixtures/test';
import { t } from '../i18n';
import { AttendancePage, ListShellPage } from '../pages';

/**
 * [9.11] The epic's cross-role proof: a teacher marks a register, the
 * server state matches what was submitted, the seeded guardian sees the
 * one real absence on their child in the portal, and an admin sees
 * exactly one flagged student for the seeded low-attendance month.
 *
 * Split into four `test()` blocks under `describe.serial` rather than
 * `test.step()`s inside one test — each leg needs a different seed role
 * (`test.use(loggedIn(role))`), and this suite's fixture gives each test
 * its own fresh API login per role (`e2e/fixtures/test.ts`'s own
 * docstring explains why storage-state files aren't shared across
 * tests). `.serial` keeps the four in one worker, in order, since leg 2
 * reads what leg 1 wrote and legs 3/4 read what the seed itself wrote.
 */

interface MySection {
  section_id: string;
  section_name: string;
  class_name: string;
}

interface RegisterStudent {
  roll_number: number;
  status: string | null;
}

const SEEDED_CLASS_NAME = 'Class 6';
const SEEDED_SECTION_NAME = 'A';

/** Fridays are the tenant's default weekly off — marking one would 422.
 * Falls back to the previous day (inside the default 2-day correction
 * window) rather than touching tenant settings just for this journey. */
function markableDateIso(): string {
  const now = new Date();
  if (now.getDay() === 5) now.setDate(now.getDate() - 1);
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(
    now.getDate(),
  ).padStart(2, '0')}`;
}

const MARK_DATE = markableDateIso();

async function findSeededSection(
  request: Parameters<typeof apiSession>[0],
  role: string,
): Promise<MySection> {
  const session = await apiSession(request, role);
  const sections = await get<MySection[]>(request, session, '/attendance/my-sections');
  const section = sections.find(
    (s) => s.class_name === SEEDED_CLASS_NAME && s.section_name === SEEDED_SECTION_NAME,
  );
  if (!section) {
    throw new Error(
      `Seeded ${SEEDED_CLASS_NAME} / ${SEEDED_SECTION_NAME} section not found — has \`yarn seed\` run?`,
    );
  }
  return section;
}

test.describe.serial('attendance: teacher marks -> guardian sees -> admin sees the flag', () => {
  test.describe('1. teacher marks the register', () => {
    test.use(loggedIn('teacher'));

    test('marks the seeded roster present, one absent, one late', async ({ page, request }) => {
      const section = await findSeededSection(request, 'teacher');
      const attendance = new AttendancePage(page);

      await attendance.gotoSection(section.section_id, MARK_DATE);
      await attendance.markAllPresent();
      await attendance.markStudent(1, AttendanceStatus.ABSENT);
      await attendance.markStudent(2, AttendanceStatus.LATE);
      await attendance.submit();

      await expect(page.getByText(t('attendance.mark.savedToast'))).toBeVisible();
    });
  });

  test.describe('2. server state reflects the marks', () => {
    test.use(loggedIn('teacher'));

    test('the register API returns the exact statuses just submitted', async ({ request }) => {
      const session = await apiSession(request, 'teacher');
      const section = await findSeededSection(request, 'teacher');

      const register = await get<{ students: RegisterStudent[] }>(
        request,
        session,
        `/attendance/sections/${section.section_id}/register?date=${MARK_DATE}`,
      );
      const byRoll = new Map(register.students.map((s) => [s.roll_number, s.status]));

      expect(byRoll.get(1)).toBe(AttendanceStatus.ABSENT);
      expect(byRoll.get(2)).toBe(AttendanceStatus.LATE);
      expect(byRoll.get(3)).toBe(AttendanceStatus.PRESENT);
    });
  });

  test.describe('3. guardian sees the absence in the portal', () => {
    test.use(loggedIn('parent'));

    test("the seeded absent day carries the absent label on the guardian's linked child", async ({
      page,
      request,
    }) => {
      // `parent@biddaloy.test` is linked to every 5th demo student across
      // the whole tenant (`ensureDemoStudents` cycles 5 guardians over the
      // full roster) — several children, not one. Find the specific one
      // this journey seeded an absence for, rather than assuming index 0.
      const session = await apiSession(request, 'parent');
      const myStudents = await get<
        {
          id: string;
          roll_number: number;
          class_section?: { section_name?: string; class?: { name?: string } };
        }[]
      >(request, session, '/students/mine');
      const target = myStudents.find(
        (s) =>
          s.roll_number === 1 &&
          s.class_section?.section_name === SEEDED_SECTION_NAME &&
          s.class_section?.class?.name === SEEDED_CLASS_NAME,
      );
      const studentId = target?.id;
      if (!studentId) {
        throw new Error(
          `parent@biddaloy.test has no linked roll-1 child in ${SEEDED_CLASS_NAME} / ${SEEDED_SECTION_NAME} — has \`yarn seed\` run?`,
        );
      }

      const attendance = new AttendancePage(page);
      await attendance.gotoPortalMonth(studentId, ATTENDANCE_SEED_ABSENT_DATE.slice(0, 7));
      await attendance.dayCell(ATTENDANCE_SEED_ABSENT_DATE).click();

      await expect(page.getByRole('dialog')).toContainText(
        t('portal.attendanceGrid.status.absent'),
      );
    });
  });

  test.describe('4. admin sees the low-attendance flag', () => {
    test.use(loggedIn('admin'));

    test('exactly one flagged student for the seeded month', async ({ page, request }) => {
      // Scoped to the seeded section — the flags endpoint evaluates every
      // student in the tenant when no section/class filter is given, and
      // every *other* seeded/created student in this shared database has
      // zero March 2026 marks, which computes as a real (not null) 0%
      // under the default WORKING_DAYS denominator, flagging all of them
      // too. Section-scoping is exactly what the reports page's own
      // filter offers a real admin for this reason.
      const section = await findSeededSection(request, 'admin');
      const flags = new ListShellPage(page, { titleKey: 'attendance.reports.title' });
      await page.goto(
        `/attendance/reports?view=flags&month=${ATTENDANCE_SEED_ABSENT_DATE.slice(0, 7)}` +
          `&section_id=${section.section_id}`,
      );
      await flags.expectLoaded();

      await expect(flags.dataRows()).toHaveCount(1);
    });
  });
});

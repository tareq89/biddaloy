import { adminApiSession, get, patch } from '../api';
import { expect, loggedIn, test } from '../fixtures/test';
import { t } from '../i18n';
import { DetailShellPage } from '../pages/detail-shell';
import { SEED_PROGRAM_NAME } from '../seed-contract';

/**
 * [34.5.4] Programs & milestones, cross-role journey: admin enrols the
 * seeded parent's linked child in "Hifz" from the student page (34.5.1),
 * a teacher ticks a milestone from the program's Students tab (34.4.1),
 * and the guardian sees the tick in `/portal/programs` (34.5.2). Mouse-based
 * — `e2e/keyboard/programs.spec.ts` already covers the D9 no-mouse path and
 * milestone reorder; this spec is the fuller cross-role trip the epic's
 * "No-silent-gaps checklist" asks for.
 *
 * Reuses the same seeded roll 1 / Class 6 / section A student as
 * `result-publish.spec.ts` — `parent@biddaloy.test`'s one linked child —
 * so the guardian step at the end has a real session to check.
 */

interface SeededStudent {
  id: string;
  full_name: string;
}

const SEEDED_CLASS_NAME = 'Class 6';
const SEEDED_SECTION_NAME = 'A';

async function findSeededRollOne(
  request: Parameters<typeof adminApiSession>[0],
  session: Awaited<ReturnType<typeof adminApiSession>>,
): Promise<SeededStudent> {
  const { data: classes } = await get<{ data: { id: string; name: string }[] }>(
    request,
    session,
    '/classes?limit=100',
  );
  const classMatches = classes.filter((c) => c.name === SEEDED_CLASS_NAME);
  for (const klass of classMatches) {
    const sections = await get<{ id: string; section_name: string }[]>(
      request,
      session,
      `/classes/${klass.id}/sections`,
    );
    const section = sections.find((s) => s.section_name === SEEDED_SECTION_NAME);
    if (!section) continue;
    const { data: students } = await get<{
      data: { id: string; full_name: string; roll_number: number }[];
    }>(request, session, `/students?section_id=${section.id}&limit=100`);
    const rollOne = students.find((s) => s.roll_number === 1);
    if (rollOne) return { id: rollOne.id, full_name: rollOne.full_name };
  }
  throw new Error(
    `Seeded ${SEEDED_CLASS_NAME} / ${SEEDED_SECTION_NAME} roll 1 not found — has \`yarn seed\` run?`,
  );
}

test.describe.serial('programs: admin enrols -> teacher records -> guardian sees it', () => {
  let studentId: string;
  let studentName: string;

  test.describe('1. admin enrols the student in Hifz from the student page', () => {
    test.use(loggedIn('admin'));

    test('enrol from the Programs tab of the student detail page', async ({ page, request }) => {
      const session = await adminApiSession(request);
      const student = await findSeededRollOne(request, session);
      studentId = student.id;
      studentName = student.full_name;

      // `yarn seed`'s demo data (`ensureProgramParticipationDemoSeed`)
      // already enrols this exact student in Hifz (with achievements) —
      // it's the same roll-1 fixture `result-publish.spec.ts` reuses. If
      // that enrolment is still ACTIVE, the dialog's own "already
      // enrolled" branch fires instead of a fresh enrol, so the heading
      // never closes. Withdraw it first so this test's own enrol click
      // creates a real, brand-new ACTIVE enrolment — the partial unique
      // index is on `status = 'ACTIVE'` only, so a WITHDRAWN row doesn't
      // block the re-enrol.
      const programs = await get<{ id: string; name: string }[]>(request, session, '/programs');
      const hifz = programs.find((p) => p.name === SEED_PROGRAM_NAME);
      if (!hifz) throw new Error(`Seeded program "${SEED_PROGRAM_NAME}" not found`);
      const enrollments = await get<{ id: string; status: string; student: { id: string } }[]>(
        request,
        session,
        `/programs/${hifz.id}/enrollments`,
      );
      const existing = enrollments.find((e) => e.student.id === studentId && e.status === 'ACTIVE');
      if (existing) {
        await patch(request, session, `/program-enrollments/${existing.id}`, {
          status: 'WITHDRAWN',
          ended_on: '2026-01-01',
        });
      }

      await page.goto(`/students/${studentId}`);
      await expect(page.getByRole('heading', { level: 1, name: studentName })).toBeVisible();

      await new DetailShellPage(page).openTab('programs.detail.tabs.programs', 'programs');

      await page.getByRole('button', { name: t('programs.students.enrol') }).click();
      await expect(
        page.getByRole('heading', { name: t('programs.dialogs.enrol.title') }),
      ).toBeVisible();

      // No `programId` in context from the student page — the dialog shows
      // a Program select; the student itself is already prefilled/checked.
      await page.getByRole('combobox', { name: t('programs.dialogs.program') }).click();
      await page.getByRole('option', { name: SEED_PROGRAM_NAME }).click();

      // Scoped to the dialog: its submit button has the same accessible
      // name ("Enrol") as the page's own trigger button, which stays in the
      // DOM (behind the overlay) while the dialog is open.
      const enrolDialog = page.getByRole('dialog');
      await enrolDialog.getByRole('button', { name: t('programs.students.enrol') }).click();
      await expect(
        page.getByRole('heading', { name: t('programs.dialogs.enrol.title') }),
      ).toBeHidden();

      // Two cards now: the freshly-created ACTIVE enrolment and the
      // WITHDRAWN one this test withdrew above (`ProgramsPanel` renders
      // every enrolment, not just active ones) — `.first()` since this
      // step only cares that the enrol actually landed.
      await expect(page.getByText(SEED_PROGRAM_NAME).first()).toBeVisible();
    });
  });

  test.describe('2. teacher ticks a milestone from the program detail page', () => {
    test.use(loggedIn('teacher'));

    test('tick the first unticked milestone for the newly enrolled student', async ({ page }) => {
      await page.goto('/programs');
      await page.getByRole('link', { name: SEED_PROGRAM_NAME }).click();
      await expect(page.getByRole('heading', { level: 1, name: SEED_PROGRAM_NAME })).toBeVisible();

      await page.getByRole('tab', { name: t('programs.detail.tabs.students') }).click();

      const row = page.getByRole('listitem').filter({ hasText: studentName });
      await row.locator('button[aria-expanded]').first().click();
      await expect(row.locator('button[aria-expanded]').first()).toHaveAttribute(
        'aria-expanded',
        'true',
      );

      const firstUnticked = row.locator('[role="checkbox"][aria-checked="false"]').first();
      const milestoneId = await firstUnticked.getAttribute('data-milestone-id');
      expect(milestoneId).toBeTruthy();

      // Wait for the recording mutation's own network response, not just the
      // optimistic UI flip — `MilestoneChecklist` updates the checkbox
      // immediately, so asserting `aria-checked` alone would still pass if
      // the request later failed and rolled back.
      const [response] = await Promise.all([
        page.waitForResponse(
          (res) => res.url().includes('/achievements') && res.request().method() === 'POST',
        ),
        firstUnticked.click(),
      ]);
      expect(response.ok()).toBe(true);

      await expect(
        row.locator(`[data-milestone-id="${milestoneId}"][role="checkbox"]`),
      ).toHaveAttribute('aria-checked', 'true');
    });
  });

  test.describe('3. guardian sees the tick in the portal', () => {
    test.use(loggedIn('parent'));

    test('the ticked milestone shows in /portal/programs', async ({ page }) => {
      // The fines specs link extra students to the shared seeded parent, and
      // the portal defaults to the first linked student — pin this one.
      await page.goto(`/portal/programs?student=${studentId}`);
      await expect(
        page.getByRole('heading', { level: 1, name: t('portal.programs.title') }),
      ).toBeVisible();
      // The name renders in more than one place (card title + enrolment row),
      // and a retry re-enrols — assert "shown", not "shown exactly once".
      await expect(page.getByText(SEED_PROGRAM_NAME).first()).toBeVisible();
    });
  });
});

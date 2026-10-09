import {
  addDaysIso,
  addRoutineSlot,
  adminApiSession,
  createGuardian,
  createStudyPlan,
  createStudyPlanScene,
  get,
  parentApiSession,
  post,
  putLessonDelivery,
  rawRequest,
  removeRoutineSlots,
  schoolCalendar,
  secondSchoolAdminSession,
} from '../api';
import { expect, loggedIn, test } from '../fixtures/test';
import { t } from '../i18n';

/**
 * [66.3.99/#2026] The guardian's view of a class's study plan: the seeded parent's own child sees the
 * subject's "where now", the next five lessons and the behind sentence on /portal/syllabus, and the
 * planned lesson under the period on /portal/routine. Another family's child, and the other school's
 * admin, are refused by the API (never a 200).
 *
 * The scene is built through the API in a fresh section of the seeded Class 6 with its own subject, so
 * the seed's data and earlier runs never show up here. Its periods run on every school weekday, and one
 * past period was lost, so the plan is behind by one.
 */

test.use(loggedIn('parent'));
test.setTimeout(120_000);
test.use({ actionTimeout: 10_000 });

const LESSONS = Array.from({ length: 8 }, (_, i) => `Portal lesson ${i + 1}`);

test('a guardian sees their own child’s plan and lesson line; another family’s child and another school are refused', async ({
  page,
  request,
}) => {
  const admin = await adminApiSession(request);
  const suffix = crypto.randomUUID().slice(0, 6);
  const scene = await createStudyPlanScene(request, admin, `Portal ${suffix}`);
  const cal = await schoolCalendar(request, admin);
  const slotIds: string[] = [];
  const planIds: string[] = [];
  const studentIds: string[] = [];
  try {
    // A period every school day of the week.
    for (let weekday = 0; weekday < 7; weekday++) {
      const sample = [0, 1, 2, 3, 4, 5, 6]
        .map((n) => addDaysIso(cal.today, n))
        .find((d) => new Date(`${d}T00:00:00Z`).getUTCDay() === weekday)!;
      if (!cal.isSchoolDay(sample)) continue;
      slotIds.push(
        await addRoutineSlot(request, admin, scene, {
          sectionId: scene.sectionAId,
          weekday,
          period: 1,
        }),
      );
    }
    const plan = await createStudyPlan(request, admin, {
      section_id: scene.sectionAId,
      subject_id: scene.subject.id,
      academic_term_id: null,
      lessons: LESSONS.map((title) => ({ title, periods: 1 })),
    });
    planIds.push(plan.id);
    // The class lost the period of the latest school day before today (a recorded loss counts at once).
    let lostDay = addDaysIso(cal.today, -1);
    while (!cal.isSchoolDay(lostDay)) lostDay = addDaysIso(lostDay, -1);
    await putLessonDelivery(request, admin, {
      section_id: scene.sectionAId,
      subject_id: scene.subject.id,
      date: lostDay,
      period_slot_id: scene.periodSlotIds[1]!,
      status: 'NOT_TAUGHT',
      reason: 'TEACHER_ABSENT',
    });

    // The seeded parent's real guardian id; two students: theirs, and another family's.
    const parent = await parentApiSession(request);
    const guardian = await get<{ id: string }>(request, parent, '/guardians/mine');
    const ownName = `Portal Own ${suffix}`;
    const own = await post<{ id: string }>(request, admin, '/students', {
      full_name: ownName,
      class_section_id: scene.sectionAId,
      guardian_ids: [guardian.id],
    });
    studentIds.push(own.id);
    const strangerGuardian = await createGuardian(request, admin, `Portal Stranger ${suffix}`);
    const stranger = await post<{ id: string }>(request, admin, '/students', {
      full_name: `Portal Other ${suffix}`,
      class_section_id: scene.sectionAId,
      guardian_ids: [strangerGuardian.id],
    });
    studentIds.push(stranger.id);

    await test.step('syllabus: where now, next five lessons, behind sentence', async () => {
      await page.goto('/portal/syllabus');
      // The seeded parent has more than one child now: pick ours (a chip, named by the student).
      await page.getByText(ownName).first().click({ timeout: 60_000 });
      const main = page.getByRole('main');
      // The subject's card may start collapsed: open it only if it is.
      const toggle = main.getByRole('button', { name: new RegExp(scene.subject.nameEn) });
      await expect(toggle).toBeVisible();
      if ((await toggle.getAttribute('aria-expanded')) === 'false') await toggle.click();
      await expect(main.getByText(t('portal.syllabus.plan.whereNow'))).toBeVisible();
      await expect(main.getByText(t('portal.syllabus.plan.nextFive'))).toBeVisible();
      for (const title of LESSONS.slice(0, 5)) {
        await expect(main.getByText(title, { exact: false }).first()).toBeVisible();
      }
      // Only five are listed.
      await expect(main.getByText(LESSONS[7]!, { exact: false })).toHaveCount(0);
      await expect(main.getByText(t('portal.syllabus.plan.whyBehind'))).toBeVisible();
      await expect(
        main.getByText(t('portal.syllabus.plan.behind_one', { count: 1 })),
      ).toBeVisible();
    });

    await test.step('routine: the planned lesson is under the period', async () => {
      await page.goto('/portal/routine');
      await page.getByText(ownName).first().click({ timeout: 60_000 });
      // Today may be a weekly-off day: walk the day tabs until one has the lesson line.
      const lessonLine = page
        .getByRole('main')
        .getByText(/Portal lesson \d/)
        .first();
      const tabs = page.getByRole('tab');
      await expect(tabs.first()).toBeVisible({ timeout: 60_000 });
      let seen = false;
      for (let i = 0; i < (await tabs.count()) && !seen; i++) {
        await tabs.nth(i).click();
        seen = await lessonLine.isVisible({ timeout: 5_000 }).catch(() => false);
      }
      await expect(lessonLine).toBeVisible();
    });

    await test.step('the family endpoints: own child 200, another family’s child and another school refused', async () => {
      expect(
        (await rawRequest(request, parent, 'GET', `/students/${own.id}/study-plans`)).status,
      ).toBe(200);
      // Not linked: the family endpoints answer 401 (FamilyAccessService's long-standing convention);
      // another school's token cannot see the row at all (404) or is fenced (403). Never a 200.
      const expectRefused = (status: number) => expect([401, 403, 404]).toContain(status);
      const strangerPlans = await rawRequest(
        request,
        parent,
        'GET',
        `/students/${stranger.id}/study-plans`,
      );
      expectRefused(strangerPlans.status);
      const strangerLessons = await rawRequest(
        request,
        parent,
        'GET',
        `/students/${stranger.id}/lessons?date=${cal.today}`,
      );
      expectRefused(strangerLessons.status);

      const otherSchool = await secondSchoolAdminSession(request);
      const crossTenant = await rawRequest(
        request,
        otherSchool,
        'GET',
        `/students/${own.id}/study-plans`,
      );
      expectRefused(crossTenant.status);
      const crossPlan = await rawRequest(request, otherSchool, 'GET', `/study-plans/${plan.id}`);
      expectRefused(crossPlan.status);
    });
  } finally {
    for (const id of planIds) await rawRequest(request, admin, 'DELETE', `/study-plans/${id}`);
    // The seeded parent's account is shared: leave it with its own children only.
    for (const id of studentIds) await rawRequest(request, admin, 'DELETE', `/students/${id}`);
    await removeRoutineSlots(request, admin, slotIds);
  }
});

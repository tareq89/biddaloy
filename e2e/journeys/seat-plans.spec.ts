import { ExamKind } from '@biddaloy/shared';
import { adminApiSession, get, post } from '../api';
import { expect, loggedIn, test } from '../fixtures/test';
import { t } from '../i18n';

/**
 * [25.8] Wave-3 close journey: generate -> edit -> publish across the whole
 * seat-plan feature (#25.4/#25.6/#25.7). Business setup (subjects, exam,
 * schedules, rooms) goes through the API — same "API sets the scene, UI
 * drives the flow" split as `result-publish.spec.ts` — because the seat
 * plan's own generate/reseat/reshuffle/publish actions are exactly what this
 * spec is testing and must go through the real UI.
 *
 * Reuses the seeded "Class 6" (sections A and B, 3 students each —
 * `seed.util.ts`'s `ensureDemoStudents`). Attaching a fresh exam to that
 * class rosters BOTH sections automatically (`SeatPlansService.buildSections`
 * groups by `exam.class_id`, not by a hand-picked section list) — that's
 * this spec's "section-mixing" assertion: one exam schedule's roster spans
 * two different `section_name`s.
 */

const SEEDED_CLASS_NAME = 'Class 6';

interface SeededClass {
  id: string;
  academic_year_id: string;
}

async function findSeededClass6(
  request: Parameters<typeof adminApiSession>[0],
  session: Awaited<ReturnType<typeof adminApiSession>>,
): Promise<SeededClass> {
  const { data: classes } = await get<{
    data: { id: string; name: string; academic_year_id: string }[];
  }>(request, session, '/classes?limit=100');
  const klass = classes.find((c) => c.name === SEEDED_CLASS_NAME);
  if (!klass) {
    throw new Error(`Seeded ${SEEDED_CLASS_NAME} not found — has \`yarn seed\` run?`);
  }
  return klass;
}

/** A hardcoded schedule date drifts out of range whenever the seeded
 * academic year's calendar year changes — derive two dates safely inside
 * the class's real academic year instead. */
async function safeScheduleDates(
  request: Parameters<typeof adminApiSession>[0],
  session: Awaited<ReturnType<typeof adminApiSession>>,
  academicYearId: string,
): Promise<{ math: string; english: string }> {
  const year = await get<{ start_date: string; end_date: string }>(
    request,
    session,
    `/academic-years/${academicYearId}`,
  );
  const start = new Date(year.start_date);
  const mathDate = new Date(start);
  mathDate.setUTCDate(mathDate.getUTCDate() + 10);
  const englishDate = new Date(start);
  englishDate.setUTCDate(englishDate.getUTCDate() + 11);
  const end = new Date(year.end_date);
  if (englishDate > end) {
    throw new Error(
      `Seeded academic year ${year.start_date}..${year.end_date} is too short for this test's schedule dates`,
    );
  }
  return {
    math: mathDate.toISOString().slice(0, 10),
    english: englishDate.toISOString().slice(0, 10),
  };
}

test.describe.serial('seat plans: generate -> reseat -> reshuffle -> publish', () => {
  test.use(loggedIn('admin'));

  let planName: string;
  let mathScheduleId: string;
  let englishScheduleId: string;
  let roomAName: string;
  let roomBName: string;

  test('generate a seat plan across two subject-sittings and two rooms', async ({
    page,
    request,
  }) => {
    const session = await adminApiSession(request);
    const klass = await findSeededClass6(request, session);

    const suffix = Date.now().toString(36).toUpperCase();
    const math = await post<{ id: string; name_en: string }>(request, session, '/subjects', {
      code: `E2ESP-MATH-${suffix}`,
      name_en: `E2E Seat Plan Math ${suffix}`,
      name_bn: `ই২ই আসন গণিত ${suffix}`,
    });
    const english = await post<{ id: string; name_en: string }>(request, session, '/subjects', {
      code: `E2ESP-ENG-${suffix}`,
      name_en: `E2E Seat Plan English ${suffix}`,
      name_bn: `ই২ই আসন ইংরেজি ${suffix}`,
    });

    planName = `E2E Seat Plan ${suffix}`;
    const exam = await post<{ id: string }>(request, session, '/exams', {
      name: `E2E Seat Plan Exam ${suffix}`,
      kind: ExamKind.TERM,
      academic_year_id: klass.academic_year_id,
      class_id: klass.id,
    });

    const scheduleDates = await safeScheduleDates(request, session, klass.academic_year_id);
    const mathSchedule = await post<{ id: string }>(
      request,
      session,
      `/exams/${exam.id}/schedule`,
      { subject_id: math.id, date: scheduleDates.math, starts_at: '09:00', ends_at: '11:00' },
    );
    mathScheduleId = mathSchedule.id;
    const englishSchedule = await post<{ id: string }>(
      request,
      session,
      `/exams/${exam.id}/schedule`,
      { subject_id: english.id, date: scheduleDates.english, starts_at: '09:00', ends_at: '11:00' },
    );
    englishScheduleId = englishSchedule.id;

    roomAName = `E2E Room A ${suffix}`;
    roomBName = `E2E Room B ${suffix}`;
    await post(request, session, '/routines/rooms', { room_no: roomAName, capacity: 10 });
    await post(request, session, '/routines/rooms', { room_no: roomBName, capacity: 10 });

    await page.goto('/exams/seat-plans');
    await expect(page.getByRole('heading', { name: t('seatPlans.list.title') })).toBeVisible();

    await page.getByRole('button', { name: t('seatPlans.list.generateButton') }).click();
    await expect(page.getByRole('dialog')).toBeVisible();

    await page.getByLabel(t('seatPlans.generate.nameLabel')).fill(planName);

    await page.getByRole('combobox', { name: t('seatPlans.generate.examLabel') }).click();
    await page.getByRole('option', { name: `E2E Seat Plan Exam ${suffix}` }).click();

    const schedulePicker = page.getByTestId('schedule-picker');
    await schedulePicker.getByRole('checkbox', { name: math.name_en }).check();
    await schedulePicker.getByRole('checkbox', { name: english.name_en }).check();

    const roomPicker = page.getByTestId('room-picker');
    await roomPicker.getByRole('checkbox', { name: roomAName }).check();
    await roomPicker.getByRole('checkbox', { name: roomBName }).check();

    await page.getByRole('button', { name: t('seatPlans.generate.submit') }).click();
    await expect(page.getByRole('dialog')).toBeHidden();

    await expect(page.getByText(planName)).toBeVisible();
  });

  test('section-mixing: the generated schedule seats both sections in the rooms', async ({
    request,
  }) => {
    const session = await adminApiSession(request);
    const plans = await get<{ id: string; name: string }[]>(request, session, '/seat-plans');
    const plan = plans.find((p) => p.name === planName);
    if (!plan) throw new Error(`Generated plan "${planName}" not found via GET /seat-plans`);

    const detail = await get<{
      rooms: { allocations: { section_name: string | null }[] }[];
    }>(request, session, `/seat-plans/${plan.id}`);
    const sectionNames = new Set(
      detail.rooms.flatMap((room) => room.allocations.map((a) => a.section_name)),
    );
    expect(sectionNames.size).toBeGreaterThan(1);
  });

  test('reseat one student and reshuffle a room, then publish', async ({ page, request }) => {
    const session = await adminApiSession(request);
    const plans = await get<{ id: string; name: string }[]>(request, session, '/seat-plans');
    const plan = plans.find((p) => p.name === planName);
    if (!plan) throw new Error(`Generated plan "${planName}" not found via GET /seat-plans`);

    await page.goto(`/exams/seat-plans/${plan.id}`);
    await expect(page.getByRole('heading', { name: planName })).toBeVisible();

    // --- reseat one student to the other room -------------------------------
    const reseatButtons = page.getByRole('button', {
      name: t('seatPlansDetail.room.reseatButton'),
    });
    await reseatButtons.first().click();
    await expect(page.getByRole('dialog')).toBeVisible();
    await page.getByRole('combobox', { name: t('seatPlansDetail.reseat.roomLabel') }).click();
    // Whichever room isn't already selected — the two seeded rooms are the
    // only two options, so picking "not roomA" always lands on roomB or
    // vice versa.
    const roomOptions = page.getByRole('option');
    await roomOptions.last().click();
    await page.getByRole('button', { name: t('seatPlansDetail.reseat.submit') }).click();
    await expect(page.getByRole('dialog')).toBeHidden();

    // --- reshuffle the first room --------------------------------------------
    await page
      .getByRole('button', { name: t('seatPlansDetail.room.reshuffleButton') })
      .first()
      .click();
    await expect(page.getByRole('alert')).toHaveCount(0);

    // --- publish --------------------------------------------------------------
    await page.getByRole('button', { name: t('seatPlansDetail.detail.publishButton') }).click();
    await expect(page.getByRole('dialog')).toBeVisible();
    await page.getByRole('button', { name: t('seatPlansDetail.publish.confirm') }).click();
    await expect(page.getByText(t('seatPlansDetail.detail.publishedBanner'))).toBeVisible();

    // Edit controls are disabled once published.
    await expect(
      page.getByRole('button', { name: t('seatPlansDetail.room.reseatButton') }).first(),
    ).toBeDisabled();
    await expect(
      page.getByRole('button', { name: t('seatPlansDetail.room.reshuffleButton') }).first(),
    ).toBeDisabled();
    await expect(
      page.getByRole('button', { name: t('seatPlansDetail.detail.publishButton') }),
    ).toBeDisabled();

    // --- re-generating against an already-published schedule is rejected ----
    const response = await request.post('/api/v1/seat-plans/generate', {
      headers: { Authorization: `Bearer ${session.token}`, 'X-Tenant-ID': session.tenantId },
      data: {
        name: 'Should be rejected',
        exam_schedule_ids: [mathScheduleId, englishScheduleId],
        room_ids: [],
        seat_order_mode: 'SEQUENTIAL',
      },
    });
    expect(response.ok()).toBe(false);
    expect([400, 409]).toContain(response.status());
  });
});

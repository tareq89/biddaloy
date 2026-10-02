import { adminApiSession, createSurvey, createTeacher, get, parentApiSession, post } from '../api';
import { surveyBody } from '../fixtures/evaluations';
import { expect, loggedIn, test } from '../fixtures/test';
import { t } from '../i18n';

/**
 * [28.4.8] Survey journey on a 375px phone (D10, D13, D22), in three serial
 * steps that share one survey: admin publishes in the UI -> the seeded guardian
 * answers in the portal -> admin closes it and still sees results SEALED
 * ("1 of 3"): the minimum number of answers (always >= 3) is not met.
 *
 * The "N reached -> averages shown" half needs 3 distinct logins on one
 * teacher-subject pair and is covered by the server suite
 * (`survey-respond.e2e-spec.ts`). The seeded demo survey is OPEN (results hidden
 * by design); this spec never closes it.
 */
const PHONE = { width: 375, height: 812 };
const stamp = Date.now();
const title = `Journey survey ${stamp}`;
const subjectName = `Journey Subject ${stamp}`;

test.describe.configure({ mode: 'serial' });
test.use({ viewport: PHONE });

let surveyId = '';

test.describe('admin publishes', () => {
  test.use(loggedIn('admin'));

  test('a draft is published from the survey page', async ({ page, request }) => {
    const admin = await adminApiSession(request);
    const parent = await parentApiSession(request);
    // The seeded parent's first linked child decides which section the teacher must teach.
    const kids = await get<{ id: string; class_section_id: string }[]>(
      request,
      parent,
      '/students/mine',
    );
    const child = await get<{ class_section: { class_id: string } }>(
      request,
      admin,
      `/students/${kids[0]!.id}`,
    );
    const teacher = await createTeacher(request, admin, `Survey Journey ${stamp}`);
    const subject = await post<{ id: string }>(request, admin, '/subjects', {
      code: `SJ-${stamp.toString(36).toUpperCase()}`,
      name_en: subjectName,
      name_bn: 'যাত্রা বিষয়',
    });
    await post(
      request,
      admin,
      `/classes/${child.class_section.class_id}/sections/${kids[0]!.class_section_id}/teachers`,
      { teacher_id: teacher.teacherId, subject_id: subject.id },
    );
    surveyId = (
      await createSurvey(
        request,
        admin,
        surveyBody(title, teacher.teacherId, subject.id, { respondent: 'GUARDIANS' }),
      )
    ).id;

    await page.goto(`/staff/evaluations/surveys/${surveyId}`);
    await page
      .getByRole('button', { name: t('evaluations.surveys.detail.publish'), exact: true })
      .click();
    await expect(page.getByText(t('evaluations.surveys.detail.sealedOpen'))).toBeVisible();
  });
});

test.describe('guardian answers', () => {
  test.use(loggedIn('parent'));

  test('rates the teacher in the portal', async ({ page }) => {
    await page.goto('/portal/surveys');
    await expect(page.getByRole('heading', { level: 2, name: title })).toBeVisible();
    await page.getByText(`Survey Journey ${stamp}`).first().click();
    await page
      .getByRole('button', { name: t('evaluations.portalSurveys.starsValue', { count: 4 }) })
      .first()
      .click();
    await page
      .getByRole('button', { name: t('evaluations.portalSurveys.submit') })
      .first()
      .click();
    await expect(page.getByText(t('evaluations.portalSurveys.sent'))).toBeVisible();
  });
});

test.describe('admin closes', () => {
  test.use(loggedIn('admin'));

  test('results stay sealed below the minimum', async ({ page }) => {
    await page.goto(`/staff/evaluations/surveys/${surveyId}`);
    await page
      .getByRole('button', { name: t('evaluations.surveys.detail.close'), exact: true })
      .click();
    await expect(page.getByRole('status').filter({ hasText: '1' }).first()).toBeVisible();
    // No average is shown while sealed.
    await expect(page.getByText(/Average|গড়/)).toHaveCount(0);
  });
});

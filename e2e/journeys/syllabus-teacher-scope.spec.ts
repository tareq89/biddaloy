import { adminApiSession, createClassSection, createTeacher, loginAsFreshUser, post } from '../api';
import { expect, loggedIn, test } from '../fixtures/test';
import { t } from '../i18n';
import { selectByTypeahead } from '../keyboard/keyboard-utils';

/**
 * [66.0 D16] A TEACHER changes syllabus topics only for a class x subject
 * they teach as SUBJECT_TEACHER. Admin sets up a class and two subjects; a
 * fresh teacher is assigned subject one only. Subject one accepts a new
 * topic; subject two answers 403 and the form shows its generic error.
 * Local e2e runs in `bn`, so labels go through `t()`.
 */

test.use(loggedIn('admin'));

test('teacher adds a topic for the subject they teach, is refused for another', async ({
  browser,
  playwright,
  baseURL,
}) => {
  const suffix = crypto.randomUUID().slice(0, 8);
  const ctx = await playwright.request.newContext({ baseURL: baseURL ?? '' });
  const subjectOneName = `E2E Taught ${suffix}`;
  const subjectTwoName = `E2E Other ${suffix}`;
  const session = await adminApiSession(ctx);
  const chain = await createClassSection(ctx, session);
  const { className } = chain;
  const mkSubject = (name: string, code: string) =>
    post<{ id: string }>(ctx, session, '/subjects', { name_en: name, code });
  const one = await mkSubject(subjectOneName, `T1${suffix}`);
  await mkSubject(subjectTwoName, `T2${suffix}`);
  const teacher = await createTeacher(ctx, session, `Syllabus Teacher ${suffix}`);
  // `subject_id` set makes this a SUBJECT_TEACHER assignment.
  await post(ctx, session, `/classes/${chain.classId}/sections/${chain.sectionId}/teachers`, {
    teacher_id: teacher.teacherId,
    subject_id: one.id,
  });

  const teacherApi = await playwright.request.newContext({ baseURL: baseURL ?? '' });
  const storageState = await loginAsFreshUser(
    teacherApi,
    baseURL ?? '',
    teacher.email,
    teacher.password,
  );
  await teacherApi.dispose();
  await ctx.dispose();

  const context = await browser.newContext({ storageState, baseURL: baseURL ?? '' });
  const page = await context.newPage();
  try {
    await page.goto('/academics/syllabus');
    await expect(page.getByRole('heading', { name: t('syllabus.list.title') })).toBeVisible();

    async function pick(subjectName: string) {
      await page.getByLabel(t('syllabus.list.classLabel'), { exact: true }).focus();
      await selectByTypeahead(page, className);
      await page.getByLabel(t('syllabus.list.subjectLabel'), { exact: true }).focus();
      await selectByTypeahead(page, subjectName);
    }
    async function addTopic(name: string) {
      // An empty topic list shows the add button twice (page header + empty state); the header one is first.
      await page
        .getByRole('button', { name: t('syllabus.list.addTopic') })
        .first()
        .click();
      await page.getByLabel(t('syllabus.form.nameLabel')).fill(name);
      await page.getByRole('button', { name: t('syllabus.form.submit') }).click();
    }

    await test.step('taught subject: the topic is added', async () => {
      await pick(subjectOneName);
      await addTopic('Taught topic');
      await expect(page.getByRole('cell', { name: 'Taught topic', exact: true })).toBeVisible();
    });

    await test.step('other subject: refused, nothing appears', async () => {
      await pick(subjectTwoName);
      await addTopic('Forbidden topic');
      await expect(page.getByRole('alert')).toContainText(t('syllabus.form.genericError'));
      await page.keyboard.press('Escape');
      await expect(page.getByRole('cell', { name: 'Forbidden topic', exact: true })).toHaveCount(0);
    });
  } finally {
    await context.close();
  }
});

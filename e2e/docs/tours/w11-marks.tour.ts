/**
 * [Epic 42 / W11] Marks entry shot: a list after it was submitted. Demo school, class teacher card.
 * The list is opened by its address (the list page hides submitted lists); it was submitted
 * once through the app's own Submit button in the same throwaway database.
 */
import { test } from '@playwright/test';

import { imgDir, requireEnv } from '../helpers/capture';
import { asRole, go, snap, step } from '../helpers/nav';

const dir = imgDir('exams-results');
const f = (name: string) => `${dir}/${name}.png`;

test('marks W11: submitted list', async ({ browser }, info) => {
  test.skip(info.project.metadata.device !== 'desktop');
  test.setTimeout(900_000);
  const page = await asRole(browser, info, 'class-teacher-8a');
  await step('marks-submitted', async () => {
    await go(
      page,
      requireEnv(
        'GUIDE_MARKS_LIST_PATH',
        'the submitted marks list path, /marks/<exam>/<section>/<subject>',
      ),
    );
    const main = page.getByRole('main');
    const submitted = main.getByText(/Only an admin can reopen|শুধু অ্যাডমিন আবার খুলতে/).first();
    await submitted.waitFor({ timeout: 10_000 });
    await snap(page, f('marks-entry-04-submitted'), [
      { target: submitted.locator('xpath=..') },
      { target: main.locator('table').first() },
    ]);
  });
});

/**
 * [Epic 42 / W11] Marks entry shot: a list after it was submitted. Demo school, class teacher card.
 * The list is opened by its address (the list page hides submitted lists); it was submitted
 * once through the app's own Submit button in the same throwaway database.
 */
import { test } from '@playwright/test';

import { imgDir } from '../helpers/capture';
import { asRole, go, snap, step } from '../helpers/nav';

const dir = imgDir('exams-results');
const f = (name: string) => `${dir}/${name}.png`;
const LIST =
  '/marks/9e5b4121-5dc9-48b3-9b2e-fcc993b0560a/221cb0bb-b231-47ff-8363-1c196ecc8390/716a968e-063b-47a9-8429-dd4a34386a22';

test('marks W11: submitted list', async ({ browser }, info) => {
  test.skip(info.project.metadata.device !== 'desktop');
  test.setTimeout(900_000);
  const page = await asRole(browser, info, 'class-teacher-8a');
  await step('marks-submitted', async () => {
    await go(page, LIST);
    const main = page.getByRole('main');
    const submitted = main.getByText(/Only an admin can reopen|শুধু অ্যাডমিন আবার খুলতে/).first();
    await submitted.waitFor({ timeout: 10_000 });
    await snap(page, f('marks-entry-04-submitted'), [
      { target: submitted.locator('xpath=..') },
      { target: main.locator('table').first() },
    ]);
  });
});

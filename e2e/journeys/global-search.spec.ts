import { adminApiSession, createStudent } from '../api';
import { loggedIn, test } from '../fixtures/test';
import { AppShellPage } from '../pages/app-shell';
import { DetailShellPage } from '../pages/detail-shell';

/**
 * [8.5.7] Journey 9: global search ([8.9.9]'s Cmd/Ctrl+K palette) from a
 * detail page to another student's detail.
 */

test.use(loggedIn('admin'));

test('search from a detail page and land on the picked result', async ({ page, request }) => {
  const session = await adminApiSession(request);
  const from = await createStudent(request, session, `Search Origin ${Date.now()}`);
  const targetName = `Search Target ${Date.now()}`;
  await createStudent(request, session, targetName);

  const shell = new AppShellPage(page);
  const detail = new DetailShellPage(page);

  await test.step('start on a detail page', async () => {
    await page.goto(`/students/${from.id}`);
  });

  await test.step('open the palette, query, pick', async () => {
    await shell.openGlobalSearch();
    await shell.searchFor(targetName);
    await shell.pickSearchResult(targetName);
  });

  await test.step('landed on the target detail', async () => {
    await detail.expectLoaded(targetName);
  });
});

import { adminApiSession, createStudentsInSection } from '../api';
import { loggedIn, test } from '../fixtures/test';
import { expectUrlParam } from '../pages/assertions';
import { DetailShellPage } from '../pages/detail-shell';
import { ListShellPage } from '../pages/list-shell';

/**
 * [8.5.7] Journey 8: URL-backed state. The list shells persist
 * search/page in the URL (`useListShellState`), detail tabs persist
 * `?tab=` (`useDetailShellTab`) — a reload or Back/Forward must restore
 * them exactly.
 */

test.use(loggedIn('admin'));

test('search + page survive a reload; Back/Forward round-trip a detail tab', async ({
  page,
}, testInfo) => {
  const request = page.request;
  const session = await adminApiSession(request);
  // 11 students with a shared unique prefix: page 2 exists at the
  // default page size of 10 once the search narrows to exactly these.
  const prefix = `UrlState${testInfo.workerIndex}x${Date.now()}`;
  await createStudentsInSection(request, session, prefix, 11);

  const list = new ListShellPage(page, {
    titleKey: 'students.list.title',
    searchLabelKey: 'students.list.searchLabel',
    openLabelKey: 'students.list.view',
  });

  await test.step('search, then go to page 2', async () => {
    await page.goto('/students');
    await list.expectLoaded();
    await list.search(prefix);
    // Wait for the debounced search to reach the URL before paging —
    // clicking Next mid-refetch races the button's disabled state.
    await expectUrlParam(page, 'search', prefix);
    await list.expectResultCount(10);
    await list.nextPage();
    await list.expectResultCount(1);
    await expectUrlParam(page, 'page', '2');
  });

  await test.step('reload restores search + page from the URL', async () => {
    await page.reload();
    await list.expectLoaded();
    await list.expectResultCount(1);
    await expectUrlParam(page, 'search', prefix);
    await expectUrlParam(page, 'page', '2');
  });

  await test.step('open a detail tab (URL-backed)', async () => {
    const detail = new DetailShellPage(page);
    // Page 2 holds exactly one of the seeded students (which one depends
    // on the list's default sort) — read its name off the row, then open.
    const rowText = (await list.dataRows().first().innerText()).trim();
    const match = rowText.match(new RegExp(`${prefix} \\d+`));
    if (!match) throw new Error(`no seeded student name in row: ${rowText}`);
    await list.openRowByText(match[0]);
    await detail.expectLoaded(match[0]);
    await detail.openTab('students.detail.tabs.fees', 'fees');
  });

  await test.step('Back returns to the list with state intact', async () => {
    await page.goBack(); // leaves ?tab=fees
    await page.goBack(); // back to the list
    await list.expectLoaded();
    await list.expectResultCount(1);
    await expectUrlParam(page, 'page', '2');
  });

  await test.step('Forward returns to the tab', async () => {
    await page.goForward();
    await page.goForward();
    await expectUrlParam(page, 'tab', 'fees');
  });
});

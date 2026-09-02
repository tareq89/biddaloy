import { adminApiSession, createStudentsInSection } from '../api';
import { expect, loggedIn, test } from '../fixtures/test';
import { ListShellPage } from '../pages/list-shell';

/**
 * [8.14.6] In-place data transitions. Paging (or any other filter
 * change) on a list route must keep the current rows mounted — dimmed,
 * `aria-busy` — while the next page loads, rather than collapsing the
 * table to a single "Loading…" cell and losing scroll position. See
 * `ui/src/components/data-table.tsx`'s `isFetching`/`loadingMessage`
 * props and the `placeholderData: keepPreviousData` factories in
 * `ui/src/hooks/*.ts`.
 */

test.use(loggedIn('admin'));

test('paging keeps rows, scroll position and table height stable while busy', async ({
  page,
}, testInfo) => {
  const request = page.request;
  const session = await adminApiSession(request);
  // 11 students so page 2 exists at the default page size (10) — same
  // shape as journeys/url-state.spec.ts's fixture.
  const prefix = `ListTransitions${testInfo.workerIndex}x${Date.now()}`;
  await createStudentsInSection(request, session, prefix, 11);

  const list = new ListShellPage(page, {
    titleKey: 'students.list.title',
    searchLabelKey: 'students.list.searchLabel',
    openLabelKey: 'students.list.view',
  });

  await page.goto('/students');
  await list.expectLoaded();
  await list.search(prefix);
  await list.expectResultCount(10);
  await list.expectBusy(false);

  const table = page.locator('table');
  const before = await table.boundingBox();
  const scrollYBefore = await page.evaluate(() => window.scrollY);

  // Fire the transition and immediately start polling — the busy window
  // is short (a real API call, not throttled here), so this races the
  // response deliberately rather than waiting first.
  const rowCountDuringTransition: number[] = [];
  const pollDuringTransition = (async () => {
    for (let i = 0; i < 20; i += 1) {
      rowCountDuringTransition.push(await list.dataRows().count());
      await page.waitForTimeout(10);
    }
  })();

  await list.nextPage();
  await pollDuringTransition;

  // (a) row count never drops to 0 during the transition — the stale
  // page-1 rows stay mounted (dimmed) until page 2's rows replace them.
  expect(rowCountDuringTransition.every((count) => count > 0)).toBe(true);

  await list.expectResultCount(1);
  await list.expectBusy(false);

  // (b) table height doesn't collapse/expand by more than a row's worth
  // — no skeleton-shaped or "Loading…"-cell-shaped layout jump.
  const after = await table.boundingBox();
  if (before && after) {
    expect(Math.abs(after.height - before.height)).toBeLessThan(80);
  }

  // (c) scroll position untouched by the transition.
  const scrollYAfter = await page.evaluate(() => window.scrollY);
  expect(scrollYAfter).toBe(scrollYBefore);
});

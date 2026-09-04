import { adminApiSession, createStudentsInSection } from '../api';
import { expect, loggedIn, test } from '../fixtures/test';
import { expectUrlParam } from '../pages/assertions';
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

/** TWO FULL PAGES, deliberately — not the 11 students
 * `journeys/url-state.spec.ts` uses to prove "page 2 exists". Assertion
 * (b) below compares the table's height across the transition, so page 2
 * has to hold as many rows as page 1: with a one-row page 2 the table
 * legitimately loses nine rows of height and that assertion measures the
 * page size rather than the layout jump it exists to catch. */
const PAGE_SIZE = 10;
const STUDENT_COUNT = PAGE_SIZE * 2;

/** A row's worth of height — the jump a skeleton or a "Loading…" cell
 * swapping in for real rows would produce. */
const ROW_HEIGHT_TOLERANCE_PX = 80;

test.use(loggedIn('admin'));

test('paging keeps rows, scroll position and table height stable while busy', async ({
  page,
}, testInfo) => {
  const request = page.request;
  const session = await adminApiSession(request);
  const prefix = `ListTransitions${testInfo.workerIndex}x${Date.now()}`;
  await createStudentsInSection(request, session, prefix, STUDENT_COUNT);

  const list = new ListShellPage(page, {
    titleKey: 'students.list.title',
    searchLabelKey: 'students.list.searchLabel',
    openLabelKey: 'students.list.view',
  });

  await page.goto('/students');
  await list.expectLoaded();
  await list.search(prefix);
  // Wait for the debounced search (300ms — `use-filter-bar-state.ts`) to
  // reach the URL before paging, the same barrier `url-state.spec.ts`
  // uses. Load-bearing here: the *unfiltered* list is a full page too, so
  // a bare row count cannot tell "search applied" from "search still
  // debouncing" — paging mid-debounce clicks Next on the unfiltered list,
  // and the search then commits and resets it straight back to page 1.
  await expectUrlParam(page, 'search', prefix);
  await list.expectResultCount(PAGE_SIZE);
  await list.expectBusy(false);

  const table = page.locator('table');
  const before = await table.boundingBox();
  const scrollYBefore = await page.evaluate(() => window.scrollY);
  const firstRowBefore = await list.dataRows().first().innerText();

  // Fire the transition and immediately start polling — the busy window
  // is short (a real API call, not throttled here), so this races the
  // response deliberately rather than waiting first.
  const rowCountDuringTransition: number[] = [];
  const heightDuringTransition: number[] = [];
  const pollDuringTransition = (async () => {
    for (let i = 0; i < 20; i += 1) {
      rowCountDuringTransition.push(await list.dataRows().count());
      heightDuringTransition.push((await table.boundingBox())?.height ?? 0);
      await page.waitForTimeout(10);
    }
  })();

  await list.nextPage();
  await pollDuringTransition;

  // (a) row count never drops to 0 during the transition — the stale
  // page-1 rows stay mounted (dimmed) until page 2's rows replace them.
  expect(rowCountDuringTransition.every((count) => count > 0)).toBe(true);

  await expectUrlParam(page, 'page', '2');
  await list.expectResultCount(PAGE_SIZE);
  await list.expectBusy(false);
  // ...and page 2's own rows really did arrive. Both pages are full, so
  // the row count alone cannot tell "paged" from "stale rows held
  // forever" — the first row's text can.
  expect(await list.dataRows().first().innerText()).not.toBe(firstRowBefore);

  // (b) the table's height never collapses or jumps — at no point during
  // the transition, and not once it settles either. Both pages are full,
  // so every sample should sit within a row's worth of the height the
  // table had before the transition started.
  if (before) {
    const settledHeight = (await table.boundingBox())?.height ?? 0;
    const jumped = [...heightDuringTransition, settledHeight].filter(
      (height) => Math.abs(height - before.height) >= ROW_HEIGHT_TOLERANCE_PX,
    );
    expect(jumped, `table height moved mid-transition: ${jumped.join(', ')}`).toEqual([]);
  }

  // (c) scroll position untouched by the transition.
  const scrollYAfter = await page.evaluate(() => window.scrollY);
  expect(scrollYAfter).toBe(scrollYBefore);
});

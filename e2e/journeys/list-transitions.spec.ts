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

  // [18.3.2] Scoped to exclude `ui/src/components/route-pending.tsx`'s
  // `SkeletonTable` — built from the same `<Table>` primitive as the real
  // DataTable, so a bare `page.locator('table')` matches both once one
  // is mounted. TanStack Router legitimately re-shows the route-level
  // pending fallback (inside `role="status"`) when a loader re-run — even
  // a same-route, search-param-only one, like this pagination click —
  // takes longer than its pending threshold; under the production build
  // (18.2.2), that threshold is crossed often enough to make this
  // intermittent rather than nonexistent. Excluding the `role="status"`
  // ancestor keeps this test locked onto the one real table.
  const table = page.locator('table:not([role="status"] table)');
  const before = await table.boundingBox();
  const scrollYBefore = await page.evaluate(() => window.scrollY);
  const firstRowBefore = await list.dataRows().first().innerText();

  // The same `role="status"` scoping as `table` above, applied to the
  // rows too. `ListShellPage.dataRows()` is deliberately unscoped — every
  // other spec wants "the rows on screen, wherever they are" — but
  // `RoutePending`'s `SkeletonTable` (`ui/src/components/skeleton.tsx`)
  // is built from the same `<Table>` parts as the real one and, unlike
  // `DataTable`'s own placeholder rows, carries no `data-placeholder`.
  // An unscoped `dataRows()` therefore counts the *fallback's* six
  // skeleton rows, so assertion (a) below would pass on the skeleton —
  // the exact opposite of what it exists to prove.
  const realRows = page.locator(
    'table:not([role="status"] table) > tbody > tr:not(:has(td[colspan])):not([data-placeholder])',
  );

  // Fire the transition and immediately start polling — the busy window
  // is short (a real API call, not throttled here), so this races the
  // response deliberately rather than waiting first.
  //
  // Rows and height are sampled as one paired instant, and an instant
  // where the real table isn't mounted at all is skipped rather than
  // recorded. That gap is the route-level pending fallback the `table`
  // locator above already excludes by design: `boundingBox()` returns
  // `null` when the locator matches nothing, and coercing that to `0`
  // scored "no table right now" as "the table collapsed to 0px" —
  // failing assertion (b) against a fallback this spec declares out of
  // scope. `samples.length` below keeps the skip from hiding a real
  // collapse.
  const samples: { rows: number; height: number }[] = [];
  const pollDuringTransition = (async () => {
    for (let i = 0; i < 20; i += 1) {
      const box = await table.boundingBox();
      if (box) samples.push({ rows: await realRows.count(), height: box.height });
      await page.waitForTimeout(10);
    }
  })();

  await list.nextPage();
  await pollDuringTransition;

  // The transition has to have been observed for (a) and (b) to mean
  // anything — without this a run where the real table was never mounted
  // during any sample would pass vacuously.
  expect(
    samples.length,
    'no real-table samples taken during the transition',
  ).toBeGreaterThanOrEqual(5);

  // (a) row count never drops to 0 during the transition — the stale
  // page-1 rows stay mounted (dimmed) until page 2's rows replace them.
  expect(samples.every(({ rows }) => rows > 0)).toBe(true);

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
    const jumped = [...samples.map(({ height }) => height), settledHeight].filter(
      (height) => Math.abs(height - before.height) >= ROW_HEIGHT_TOLERANCE_PX,
    );
    expect(jumped, `table height moved mid-transition: ${jumped.join(', ')}`).toEqual([]);
  }

  // (c) scroll position untouched by the transition.
  const scrollYAfter = await page.evaluate(() => window.scrollY);
  expect(scrollYAfter).toBe(scrollYBefore);
});

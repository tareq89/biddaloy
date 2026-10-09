import { adminApiSession, seededFirstTermExamId } from '../api';
import { expect, loggedIn, test } from '../fixtures/test';
import { t } from '../i18n';
import { expectNoHorizontalScroll, expectNoInnerHorizontalScroll } from '../pages/assertions';

/**
 * [48.4.03] The route-level reflow sweep (`reflow.spec.ts`) only opens each route's default state.
 * Epic 48's screens are tab states of existing routes, so this sweep opens them directly at the
 * two WCAG 1.4.10 widths (320 px = 400%, 640 px = 200% of a 1280 design): the exam Print tab,
 * and both new Printables tabs. The document page is a route of its own (swept by
 * `reflow.spec.ts`) and the issue-certificate modal is covered by the a11y overlay scan
 * (`/students/$studentId::issue-certificate`).
 */

test.use(loggedIn('admin'));

/**
 * At 320 px the shared `Tabs` list (`ui/src/primitives/tabs.tsx`) scrolls sideways on EVERY page
 * that has tabs, Epic 48's included (the route-level `reflow.spec.ts` fails the same way on
 * `/exams/$examId`, `/students/$studentId` and `/reports/printables`). It is a kit change, not a
 * screen fix, so the 320 px cases are `fixme` until the kit issue (#1986) lands.
 */
const KIT_TABS_320 = 'Tabs list scrolls at 320px (shared kit, not Epic 48; #1986)';

const WIDTHS = [320, 640] as const;

for (const width of WIDTHS) {
  test.describe(`Epic 48 tab states at ${width}px @sweep`, () => {
    test.fixme(width === 320, KIT_TABS_320);
    test('exam Print tab', async ({ page, request }) => {
      const session = await adminApiSession(request);
      const examId = await seededFirstTermExamId(request, session);
      await page.setViewportSize({ width, height: 900 });
      await page.goto(`/exams/${examId}?tab=print`);
      await expect(
        page.getByRole('heading', { name: t('examDocuments.phase.before') }),
      ).toBeVisible();
      await expectNoHorizontalScroll(page);
      await expectNoInnerHorizontalScroll(page);
    });

    for (const [tab, label] of [
      ['register', 'printHistory.tabs.register'],
      ['to-print', 'printHistory.tabs.toPrint'],
    ] as const) {
      test(`Printables ${tab} tab`, async ({ page }) => {
        await page.setViewportSize({ width, height: 900 });
        await page.goto(`/reports/printables?tab=${tab}`);
        await expect(page.getByRole('tab', { name: t(label), selected: true })).toBeVisible();
        await expectNoHorizontalScroll(page);
        await expectNoInnerHorizontalScroll(page);
      });
    }
  });
}

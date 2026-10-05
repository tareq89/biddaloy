import { adminApiSession, get, post } from '../api';
import { shells } from '../config';
import { expect, loggedIn, test } from '../fixtures/test';
import { t } from '../i18n';
import { SEED_CALENDAR_EVENT_NAMES } from '../seed-contract';

/**
 * [17.4.4] Wave-close proof of the whole calendar surface built in this
 * wave: an admin creates a published event and sees it land on the grid,
 * a seeded past event shows as locked with no mutation controls, a
 * TEACHER (read-only via `CALENDAR_READ`, no `CALENDAR_MANAGE`) sees the
 * grid but none of the admin-only controls, and the per-user ICS feed
 * actually serves a `text/calendar` body containing a just-created event.
 *
 * The past-locked date is a fixed 2026 value, inside the seeded 2026-01-01..
 * 2026-12-31 academic year (`seed.util.ts`). The create date is derived
 * ("tomorrow", school-local) rather than hardcoded — the server's past-lock
 * (`assertNotPast` in `calendar-events.service.ts`) measures "today" in the
 * tenant's timezone (Asia/Dhaka by default, `tenant-settings-defaults.ts`),
 * so a fixed create date eventually becomes "yesterday" there and every
 * create silently 422s. See this file's own D-note in the published plan
 * (issue #720): this still breaks once "tomorrow" leaves the seeded 2026
 * academic year (i.e. on 2026-12-31) and needs a seed refresh then, not a
 * patch here.
 */

const SCHOOL_TIMEZONE = 'Asia/Dhaka';
const CREATE_DATE = new Intl.DateTimeFormat('en-CA', { timeZone: SCHOOL_TIMEZONE }).format(
  new Date(Date.now() + 24 * 60 * 60 * 1000),
);
const CREATE_MONTH = CREATE_DATE.slice(0, 7);
const PAST_LOCKED_MONTH = '2026-06';
const PAST_LOCKED_DATE = '2026-06-15'; // SEED_CALENDAR_EVENT_NAMES.exam start date

test.describe.serial('calendar: create -> grid, past-lock, teacher read-only, feed smoke', () => {
  test.describe('1. admin creates a published event and sees it on the grid', () => {
    test.use(loggedIn('admin'));

    test('new event appears in its day cell', async ({ page }) => {
      const eventName = `E2E Calendar Event ${Date.now()}`;

      await page.goto(`/calendar?month=${CREATE_MONTH}`);
      await expect(page.getByRole('heading', { name: t('calendar.page.title') })).toBeVisible();

      await page.getByRole('button', { name: t('calendar.page.addEvent') }).click();
      await expect(
        page.getByRole('heading', { name: t('calendar.eventForm.createTitle') }),
      ).toBeVisible();

      await page.locator('#event-form-name').fill(eventName);
      for (const label of [t('calendar.eventForm.startDate'), t('calendar.eventForm.endDate')]) {
        await page.getByLabel(label).click();
        // isVisible() does not wait: let the picker's grid paint first.
        await expect(page.getByRole('grid', { name: t('common.date.calendar') })).toBeVisible();
        const cell = page.locator(`[role="grid"] [data-date="${CREATE_DATE}"]`);
        // tomorrow can be next month
        if (!(await cell.isVisible())) {
          await page.getByRole('button', { name: t('common.date.nextMonth') }).click();
        }
        await cell.click();
        // let this picker finish closing, or the next one's grid matches twice
        await expect(cell).toBeHidden();
      }
      // Publish immediately is checked by default — leave it, so the
      // event is visible on the grid without an extra publish step.
      await page.getByRole('button', { name: t('calendar.eventForm.save') }).click();

      // The full-page form closes on save, back to the month grid.
      const dayCell = page.getByTestId(`day-cell-${CREATE_DATE}`);
      await expect(dayCell.getByText(eventName)).toBeVisible();
    });
  });

  test.describe('2. seeded past event shows locked, no mutation controls', () => {
    test.use(loggedIn('admin'));

    test('past exam event is locked in its details panel', async ({ page }) => {
      await page.goto(`/calendar?month=${PAST_LOCKED_MONTH}`);

      const dayCell = page.getByTestId(`day-cell-${PAST_LOCKED_DATE}`);
      await dayCell.getByText(SEED_CALENDAR_EVENT_NAMES.exam).click();

      await expect(page.getByRole('status')).toHaveText(t('calendar.eventDetails.locked'));
      await expect(page.getByRole('button', { name: t('calendar.eventDetails.edit') })).toHaveCount(
        0,
      );
      await expect(
        page.getByRole('button', { name: t('calendar.eventDetails.delete') }),
      ).toHaveCount(0);
    });
  });

  test.describe('3. TEACHER sees the grid read-only, no admin controls', () => {
    test.use(loggedIn('teacher'));

    test('no add-event / government-holidays / edit / delete controls', async ({ page }) => {
      await page.goto(`/calendar?month=${PAST_LOCKED_MONTH}`);

      await expect(page.getByRole('heading', { name: t('calendar.page.title') })).toBeVisible();
      await expect(page.getByTestId('month-grid')).toBeVisible();

      await expect(page.getByRole('button', { name: t('calendar.page.addEvent') })).toHaveCount(0);
      await expect(
        page.getByRole('button', { name: t('calendar.page.governmentHolidays') }),
      ).toHaveCount(0);

      const dayCell = page.getByTestId(`day-cell-${PAST_LOCKED_DATE}`);
      await dayCell.getByText(SEED_CALENDAR_EVENT_NAMES.exam).click();

      await expect(page.getByRole('button', { name: t('calendar.eventDetails.edit') })).toHaveCount(
        0,
      );
      await expect(
        page.getByRole('button', { name: t('calendar.eventDetails.delete') }),
      ).toHaveCount(0);
      await expect(
        page.getByRole('button', { name: t('calendar.eventDetails.publish') }),
      ).toHaveCount(0);
    });
  });

  test.describe('4. feed smoke — ICS body contains a just-created event', () => {
    test('subscribe URL serves text/calendar with the event in it', async ({ playwright }) => {
      const request = await playwright.request.newContext({ baseURL: shells.app.baseURL });
      try {
        const admin = await adminApiSession(request);

        const eventName = `E2E Feed Event ${Date.now()}`;
        await post(request, admin, '/calendar/events', {
          type: 'EVENT',
          name: eventName,
          start_date: CREATE_DATE,
          end_date: CREATE_DATE,
          counts_as_working_day: true,
          publish: true,
        });

        const { url } = await get<{ url: string }>(request, admin, '/calendar/feed');
        expect(url).toMatch(/\/api\/v1\/calendar\/feed\/.+\.ics$/);

        const feedPath = new URL(url).pathname;
        const feedResponse = await request.get(feedPath);
        expect(feedResponse.ok()).toBe(true);
        expect(feedResponse.headers()['content-type']).toContain('text/calendar');

        // ICS folds long lines at 75 octets with a "\r\n " continuation —
        // unfold before substring-matching the event name.
        const body = (await feedResponse.text()).replace(/\r\n /g, '');
        expect(body).toContain('BEGIN:VCALENDAR');
        expect(body).toContain(eventName);
      } finally {
        await request.dispose();
      }
    });
  });
});

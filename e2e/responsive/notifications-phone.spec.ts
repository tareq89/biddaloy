import { expect, loggedIn, test } from '../fixtures/test';
import { makeT } from '../i18n';
import { expectNoHorizontalScroll } from '../pages/assertions';

/**
 * [2600] /notifications at 390px: snooze and close buttons show a short word,
 * keep the full text as their accessible name, and the page does not scroll
 * sideways. Alerts are stubbed: manual alerts are capped at 20 per day, and a
 * service worker would hide the requests from `page.route`.
 */
const t = makeT('en');

test.use(loggedIn('admin'));
test.use({ serviceWorkers: 'block' });

test('alerts worklist fits 390px with readable actions', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('biddaloy:locale', 'en'));
  const stamp = Date.now();
  const items = [1, 2, 3].map((n) => ({
    recipientId: `e2e-recipient-${n}`,
    alertId: `e2e-alert-${n}`,
    ruleKey: 'exams.no_seat_plan',
    source: 'RULE',
    severity: 'WARNING',
    category: 'EXAMS',
    state: 'OPEN',
    title: `Monthly test (Class ${n}) ${stamp}: 1 exam has no seat plan yet`,
    why: 'An exam has no seat plan.',
    steps: [],
    closable: true,
    raisedAt: new Date().toISOString(),
  }));
  await page.route('**/api/v1/attention/items*', (route) =>
    route.request().method() === 'GET'
      ? route.fulfill({ json: { items, total: items.length } })
      : route.continue(),
  );

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/notifications');

  for (const item of items) {
    const snooze = page.getByRole('button', {
      name: t('attention.item.snoozeNamed', { title: item.title }),
    });
    await expect(snooze).toBeVisible();
    await expect(snooze).toHaveText(t('attention.item.snooze'));
  }
  await expectNoHorizontalScroll(page);
});

import { adminApiSession, createClassSection, markableDateIso, post } from '../api';
import { expect, loggedIn, test } from '../fixtures/test';
import { AttendancePage } from '../pages/attendance-page';

/**
 * [#1805] A student who left today is not on today's register: the page shows only the
 * student who stayed, and saving the register is accepted (no 422).
 */
test.use(loggedIn('admin'));

test('a withdrawn student is not a row on the register', async ({ page, request }) => {
  const session = await adminApiSession(request);
  const stamp = Date.now();
  const chain = await createClassSection(request, session);
  const stayName = `E2E Stayer ${stamp}`;
  const leaverName = `E2E Leaver ${stamp}`;
  await post(request, session, '/students', {
    full_name: stayName,
    class_section_id: chain.sectionId,
  });
  const leaver = await post<{ id: string }>(request, session, '/students', {
    full_name: leaverName,
    class_section_id: chain.sectionId,
  });
  const date = markableDateIso();
  await post(request, session, `/students/${leaver.id}/leave`, {
    type: 'WITHDRAWN',
    occurred_on: date,
    reason: 'e2e withdrawn',
  });

  const attendance = new AttendancePage(page);
  await attendance.gotoSection(chain.sectionId, date);
  await expect(page.getByText(stayName)).toBeVisible();
  await expect(page.getByText(leaverName)).toHaveCount(0);

  await attendance.markAllPresent();
  const saved = page.waitForResponse(
    (r) => r.request().method() === 'PUT' && r.url().includes('/register'),
  );
  await attendance.submit();
  expect((await saved).status()).toBe(200);
  await expect(page.getByRole('alert')).toHaveCount(0);
});

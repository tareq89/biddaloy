import { adminApiSession, createInvitedStaffUser } from '../api';
import { guest, test, expect } from '../fixtures/test';
import { ActivatePage } from '../pages/activate-page';

/**
 * [12.2] Journey: an admin creates a passwordless user, the invite link
 * (intercepted via `invitation.debug.token` rather than the real delivery
 * channel — see `createInvitedStaffUser`'s own comment) activates the
 * account, and the invitee lands signed in. Run once at 320×568 — the
 * mobile-first shape the issue's own AC calls out, since guardians open
 * this link from an SMS on a phone.
 */
test.use(guest);

test('admin creates a user, the invite link activates the account, and a second visit shows "already used"', async ({
  page,
  request,
}) => {
  await page.setViewportSize({ width: 320, height: 568 });

  const admin = await adminApiSession(request);
  const invitee = await createInvitedStaffUser(request, admin, 'Rahima Activation E2E');

  const activate = new ActivatePage(page);

  await test.step('activate the account', async () => {
    await activate.goto(invitee.token);
    await activate.expectWelcome('Rahima Activation E2E');
    await activate.setPassword('a-strong-new-password');
  });

  await test.step('auto signed-in, lands in the staff shell', async () => {
    await expect(page).toHaveURL(/\/dashboard/);
  });

  await test.step('a second visit to the same link shows "already used"', async () => {
    await activate.goto(invitee.token);
    await activate.expectAlreadyUsed();
  });
});

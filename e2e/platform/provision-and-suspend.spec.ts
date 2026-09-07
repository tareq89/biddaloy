import {
  addSchoolAdmin,
  findSchoolIdBySlug,
  resendSchoolAdminInvitation,
  superAdminApiSession,
} from '../api';
import { expect, loggedIn, test } from '../fixtures/test';
import { t } from '../i18n';
import { ActivatePage } from '../pages/activate-page';
import { AppShellPage } from '../pages/app-shell';
import { DetailShellPage } from '../pages/detail-shell';
import { SchoolPickerPage } from '../pages/school-picker';

/**
 * [15.4.11 / #536] Proof of the epic's two tenant-lifecycle DoD lines end
 * to end: a SUPER_ADMIN provisions a school through the wizard
 * (`/schools/new`, #529/#534), the invited ADMIN activates and signs in
 * (12.2's own activation mechanism — `resendSchoolAdminInvitation` below
 * is this spec's equivalent of `createInvitedStaffUser`'s
 * `invitation.debug.token` trick, since the SUPER_ADMIN console had no
 * existing route that echoed it — see that helper's own comment),
 * SUPER_ADMIN suspends the school with a reason (#530/#535), the ADMIN's
 * next request is blocked while an unrelated tenant they also belong to
 * keeps working (proves suspension is scoped, not global), then
 * reactivation restores access.
 *
 * Zero DB/seed-script access for the new school itself — it exists only
 * because this spec drove `POST /schools` through the real wizard UI.
 * The pre-existing fixtures it *does* reuse (the seeded `super_admin`
 * account, and the seeded `admin`'s second "Rose Valley School" tenant —
 * see `seed.util.ts`'s `ensureSecondSchoolMembership`) are exactly the
 * "pre-existing fixtures" #536's acceptance criteria carve out; this
 * spec needed neither fixture extended, since both already existed.
 *
 * A suspended tenant's next API call 403s with `details.code ===
 * 'TENANT_SUSPENDED'` (`ContextGuard`); `RouteErrorFallback`
 * (`ui/src/components/route-error-boundary.tsx`) renders its dedicated
 * suspended fork for that shape — `role="status"`, not `role="alert"`,
 * since this isn't an application fault.
 */

test.use(loggedIn('super_admin'));

test('provision a school, activate its admin, suspend it, and reactivate it', async ({
  page,
  request,
  browser,
}) => {
  const suffix = `${Date.now()}-${Math.floor(Math.random() * 1_000_000)}`;
  const schoolName = `E2E Provisioned School ${suffix}`;
  const adminName = `Provisioned Admin ${suffix}`;
  const adminEmail = `provisioned-admin-${suffix}@e2e.example.com`;

  let schoolId = '';
  let adminUserId = '';

  await test.step('SUPER_ADMIN provisions a new school and its first admin via the wizard', async () => {
    await page.goto('/schools/new');

    await page.getByLabel(t('platform.createWizard.nameLabel')).fill(schoolName);
    await page.getByRole('button', { name: t('platform.createWizard.nextAction') }).click();

    await page.getByLabel(t('platform.createWizard.adminNameLabel')).fill(adminName);
    await page.getByLabel(t('platform.createWizard.adminEmailLabel')).fill(adminEmail);

    const provisionResponse = page.waitForResponse(
      (res) => res.url().includes('/api/v1/schools') && res.request().method() === 'POST',
    );
    await page.getByRole('button', { name: t('platform.createWizard.submitAction') }).click();
    const response = await provisionResponse;
    const body = (await response.json()) as {
      school: { id: string };
      admin: { user_id: string };
    };
    schoolId = body.school.id;
    adminUserId = body.admin.user_id;

    await expect(
      page.getByRole('heading', { name: t('platform.createWizard.successTitle') }),
    ).toBeVisible();
  });

  const superAdmin = await superAdminApiSession(request);

  await test.step('the same admin also gets a second, unrelated seeded tenant', async () => {
    // Rose Valley School already exists — `seed.util.ts`'s
    // `ensureSecondSchoolMembership` seeds it for the shared `admin`
    // fixture. Adding *this* freshly-provisioned admin (matched by
    // email) as its ADMIN too proves the later suspension check is
    // scoped to one tenant, not the user.
    const roseValleyId = await findSchoolIdBySlug(request, superAdmin, 'rose-valley-school');
    await addSchoolAdmin(request, superAdmin, roseValleyId, adminName, adminEmail);
  });

  const adminContext = await browser.newContext();
  const adminPage = await adminContext.newPage();

  await test.step('the invited admin activates, sets a password, and lands in the new school', async () => {
    const token = await resendSchoolAdminInvitation(request, superAdmin, schoolId, adminUserId);

    const activate = new ActivatePage(adminPage);
    await activate.goto(token);
    await activate.expectWelcome(adminName);
    await activate.setPassword('a-strong-new-password-1');

    // Two tenant memberships now (the new school + Rose Valley) — lands
    // on the picker rather than auto-continuing, same branch
    // `journeys/tenant.spec.ts`'s multi-membership admin takes.
    const picker = new SchoolPickerPage(adminPage);
    await picker.expectLoaded();
    await picker.choose(schoolName);
    await expect(adminPage).toHaveURL(/\/dashboard/);
  });

  await test.step('SUPER_ADMIN suspends the new school with a reason', async () => {
    await page.goto(`/schools/${schoolId}`);
    const detail = new DetailShellPage(page);
    await detail.expectLoaded(schoolName);
    await detail.clickAction('platform.schoolDetail.actions.suspend');

    const dialog = page.getByRole('dialog');
    await dialog
      .getByLabel(t('platform.schoolDetail.statusDialog.reasonLabel'))
      .fill('E2E suspension — provision-and-suspend.spec.ts');

    const statusResponse = page.waitForResponse(
      (res) =>
        res.url().includes(`/schools/${schoolId}/status`) && res.request().method() === 'PATCH',
    );
    await dialog
      .getByRole('button', { name: t('platform.schoolDetail.suspendDialog.confirm') })
      .click();
    await statusResponse;
  });

  await test.step("the admin's next request against the suspended school shows the suspended state", async () => {
    // /settings hits `GET /schools/:id/settings`, which `ContextGuard`
    // now blocks with 403 TENANT_SUSPENDED — /dashboard itself is a
    // static placeholder with no query, so it wouldn't surface this.
    await adminPage.goto('/settings');
    await expect(adminPage.getByRole('status')).toBeVisible();
    await expect(adminPage.getByRole('heading', { name: /suspended/i })).toBeVisible();
  });

  await test.step('the second, unrelated seeded tenant still loads fine', async () => {
    const shell = new AppShellPage(adminPage);
    await adminPage.goto('/dashboard');
    await shell.switchSchool('Rose Valley School');
    await expect(adminPage).toHaveURL(/\/dashboard/);
    await shell.expectCurrentSchool('Rose Valley School');
  });

  await test.step('SUPER_ADMIN reactivates the school', async () => {
    await page.goto(`/schools/${schoolId}`);
    const detail = new DetailShellPage(page);
    await detail.clickAction('platform.schoolDetail.actions.reactivate');

    const dialog = page.getByRole('dialog');
    await dialog
      .getByLabel(t('platform.schoolDetail.statusDialog.reasonLabel'))
      .fill('E2E reactivation — provision-and-suspend.spec.ts');

    const statusResponse = page.waitForResponse(
      (res) =>
        res.url().includes(`/schools/${schoolId}/status`) && res.request().method() === 'PATCH',
    );
    await dialog
      .getByRole('button', { name: t('platform.schoolDetail.reactivateDialog.confirm') })
      .click();
    await statusResponse;
  });

  await test.step('the admin can load the reactivated school again', async () => {
    const shell = new AppShellPage(adminPage);
    await shell.switchSchool(schoolName);
    await adminPage.goto('/settings');
    // The suspended fallback renders as `role="status"` (asserted above), so
    // a missing `role="alert"` alone would not prove reactivation — assert
    // the real settings page rendered and the suspended notice is gone.
    await expect(
      adminPage.getByRole('heading', { level: 1, name: t('settings.title') }),
    ).toBeVisible();
    await expect(adminPage.getByRole('status')).toHaveCount(0);
  });

  await adminContext.close();
});

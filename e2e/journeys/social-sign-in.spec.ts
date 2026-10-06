import { guest, test, expect } from '../fixtures/test';
import { t } from '../i18n';
import { LoginPage } from '../pages/login-page';

/**
 * [13.7.2] Social sign-in, client side and the one public server page.
 *
 * The e2e stack has no Google or Facebook, and the server's callback talks to
 * the real provider (token exchange), with no test seam. So the provider
 * round trip (register / connect / sign in / disconnect) is NOT covered here;
 * it is covered by the server's `social-auth.controller.e2e-spec.ts` and the
 * manual owner checklist in docs/architecture/22-onboarding.md. What this
 * proves: the buttons appear for each configured provider, point at the
 * server's start URL, the "not connected" return path is explained, and
 * Meta's data-deletion status page is reachable without signing in.
 */
test.describe('social sign-in', () => {
  test.use(guest);

  test.beforeEach(async ({ page }) => {
    await page.route('**/api/v1/auth/social/providers', (route) =>
      route.fulfill({ json: { providers: ['google', 'facebook'] } }),
    );
  });

  test('login lists both providers and each points at the server start URL', async ({ page }) => {
    await new LoginPage(page).goto();
    for (const provider of ['google', 'facebook'] as const) {
      const link = page.getByRole('link', { name: t(`auth.login.${provider}`) });
      await expect(link).toHaveAttribute(
        'href',
        `/api/v1/auth/social/${provider}/start?intent=login`,
      );
    }
  });

  test('register lists both providers', async ({ page }) => {
    await page.goto('/register');
    for (const provider of ['google', 'facebook'] as const) {
      await expect(
        page.getByRole('link', { name: t(`register.social.${provider}`) }),
      ).toBeVisible();
    }
  });

  test('a provider account that is not connected lands on login with an explanation', async ({
    page,
  }) => {
    // Stand in for the provider + callback: the server would 302 here.
    await page.route('**/api/v1/auth/social/facebook/start*', (route) =>
      route.fulfill({ status: 302, headers: { location: '/login?social=not_linked' } }),
    );
    await new LoginPage(page).goto();
    await page.getByRole('link', { name: t('auth.login.facebook') }).click();
    await expect(page.getByText(t('auth.login.socialNotLinked'))).toBeVisible();
  });

  test("Meta's data-deletion status page is public and bilingual", async ({ request }) => {
    const code = '3f2b7c1e-9d4a-4e0b-8c55-6a1d2e3f4a5b';
    const res = await request.get(`/api/v1/auth/social/facebook/data-deletion/status?code=${code}`);
    expect(res.status()).toBe(200);
    expect(res.headers()['content-type']).toContain('text/html');
    const body = await res.text();
    expect(body).toContain(code);
    expect(body).toContain('lang="bn"');
  });
});

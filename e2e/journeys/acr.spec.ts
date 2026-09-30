import { adminApiSession, createAcr, currentAcademicYearId, post } from '../api';
import { acrBody } from '../fixtures/evaluations';
import { expect, loggedIn, test } from '../fixtures/test';
import { t } from '../i18n';

/**
 * [28.3.7] Evaluations access journeys (D2, D21):
 *  - a TEACHER cannot open the Evaluations page (no ACR_READ);
 *  - a subject cannot read their own ACR: the API answers 404, not 403.
 * The happy-path form/keyboard flow lives in `keyboard/acr-form.spec.ts`.
 */

test.describe('teacher', () => {
  test.use(loggedIn('teacher'));

  test('cannot open Evaluations', async ({ page }) => {
    await page.goto('/staff/evaluations');
    await expect(page.getByRole('heading', { name: t('common.accessDenied.title') })).toBeVisible();
  });
});

test('the subject cannot read their own ACR: 404, not 403 (D2)', async ({
  request,
  baseURL,
  playwright,
}) => {
  const session = await adminApiSession(request);
  const suffix = crypto.randomUUID();
  const email = `acr-subject-${suffix}@e2e.example.com`;
  const password = `E2e-Subject-${suffix}`;
  const subject = await post<{ user: { id: string } }>(request, session, '/users', {
    full_name: `ACR Subject Admin ${Date.now()}`,
    email,
    password,
    role: 'ADMIN',
    tenantId: session.tenantId,
  });
  const acr = await createAcr(
    request,
    session,
    acrBody(subject.user.id, await currentAcademicYearId(request, session)),
  );

  // A separate context, so this login does not replace the shared one's cookies.
  const ctx = await playwright.request.newContext({ baseURL: baseURL ?? '' });
  try {
    const login = await ctx.post('/api/v1/auth/login', { data: { email, password } });
    expect(login.ok()).toBe(true);
    const { access_token: token } = (await login.json()) as { access_token: string };
    const headers = { Authorization: `Bearer ${token}`, 'X-Tenant-ID': session.tenantId };
    expect((await ctx.get(`/api/v1/acr/assessments/${acr.id}`, { headers })).status()).toBe(404);
    expect((await ctx.get(`/api/v1/acr/staff/${subject.user.id}`, { headers })).status()).toBe(404);
  } finally {
    await ctx.dispose();
  }
});

import { request as pwRequest, type APIRequestContext } from '@playwright/test';

import { shells } from '../config';
import { expect, loggedIn, test } from '../fixtures/test';
import { t } from '../i18n';
import {
  SEED_ASSISTANT_TEACHER_EMAIL,
  SEED_PASSWORD_ENV,
  SEED_ROLE_EMAILS,
} from '../seed-contract';

/**
 * [47.4.4] Epic 47 close journey: the class teacher's "My class" screen on
 * the seed. Local e2e runs in `bn`, so every label is an ARIA role or a
 * translation key resolved through `t()`.
 *
 * Seed (see `seed-contract.ts`): `teacher@biddaloy.test` is CLASS_TEACHER of
 * one section and `assistant-teacher@biddaloy.test` its
 * ASSISTANT_CLASS_TEACHER, so `/my-class` redirects straight to that
 * section's page for both. The role badge only renders on the picker (2+
 * sections), so the assistant's role is asserted on the API instead.
 */

interface MySection {
  section_id: string;
  class_name: string;
  section_name: string;
  assignment_type: string;
}

interface Login {
  api: APIRequestContext;
  getJson: <T>(path: string, params?: Record<string, string>) => Promise<T>;
  tenantId: string;
  role: string;
  storageState: Awaited<ReturnType<APIRequestContext['storageState']>>;
  sections: MySection[];
}

async function login(email: string): Promise<Login> {
  const password = process.env[SEED_PASSWORD_ENV];
  if (!password) throw new Error(`${SEED_PASSWORD_ENV} is not set`);
  const api = await pwRequest.newContext({ baseURL: shells.app.baseURL });
  const res = await api.post('/api/v1/auth/login', { data: { email, password } });
  if (!res.ok()) throw new Error(`login failed for ${email}: ${res.status()}`);
  const body = (await res.json()) as {
    access_token: string;
    memberships: { tenantId: string; role: string }[];
  };
  const membership = body.memberships.find((m) => m.role === 'TEACHER');
  if (!membership) throw new Error(`no TEACHER membership for ${email}`);
  const getJson = async <T>(path: string, params?: Record<string, string>): Promise<T> => {
    const res = await api.get(`/api/v1${path}`, {
      headers: {
        Authorization: `Bearer ${body.access_token}`,
        'X-Tenant-ID': membership.tenantId,
      },
      ...(params ? { params } : {}),
    });
    if (!res.ok()) throw new Error(`GET ${path} failed: ${res.status()}`);
    return (await res.json()) as T;
  };
  return {
    api,
    getJson,
    tenantId: membership.tenantId,
    role: membership.role,
    storageState: await api.storageState(),
    sections: await getJson<MySection[]>('/my-class/sections'),
  };
}

test.describe('class teacher', () => {
  test.use(loggedIn('teacher'));

  test('opens My class from the nav, sees six cards and the streak students, takes attendance', async ({
    page,
  }) => {
    const seeded = await login(SEED_ROLE_EMAILS.teacher);
    expect(seeded.sections).toHaveLength(1);
    const section = seeded.sections[0]!;
    expect(section.assignment_type).toBe('CLASS_TEACHER');
    // Read before the page loads, so the card's own fetch is never older.
    // Not the seed's three streak names: `journeys/attendance.spec.ts` marks
    // this section's register for today, which rewrites the streaks. The
    // seed's streak shape is pinned by `seed.util.spec.ts` instead.
    const streaks = await seeded.getJson<{ items: { student_name: string }[] }>(
      `/attendance/sections/${section.section_id}/streaks`,
    );
    expect(streaks.items.length).toBeGreaterThan(0);
    await seeded.api.dispose();

    await page.goto('/dashboard');
    await page.getByRole('link', { name: t('nav.items.myClass') }).click();

    // One section: `/my-class` redirects to its page.
    await expect(page).toHaveURL(new RegExp(`/my-class/${section.section_id}$`));
    await expect(
      page.getByRole('heading', {
        level: 1,
        name: t('myClass.pageTitle', {
          section: `${section.class_name}-${section.section_name}`,
        }),
      }),
    ).toBeVisible();

    for (const card of ['absentees', 'flags', 'dues', 'homework', 'results', 'roster']) {
      await expect(
        page.getByRole('heading', { level: 2, name: t(`myClass.cards.${card}`) }),
      ).toBeVisible();
    }

    // Streaks: the card shows exactly what the server computes.
    const flags = page.getByRole('region', { name: t('myClass.cards.flags') });
    for (const { student_name } of streaks.items) {
      await expect(flags.getByText(student_name)).toBeVisible();
    }

    await page.getByRole('link', { name: t('myClass.takeAttendance') }).click();
    await expect(page).toHaveURL(new RegExp(`/attendance/${section.section_id}`));
    await expect(
      page.getByRole('heading', { name: section.class_name, exact: false }).first(),
    ).toBeVisible();
  });
});

test('assistant class teacher sees the same section', async ({ browser }) => {
  const teacher = await login(SEED_ROLE_EMAILS.teacher);
  const assistant = await login(SEED_ASSISTANT_TEACHER_EMAIL);
  await teacher.api.dispose();
  await assistant.api.dispose();

  expect(assistant.sections).toHaveLength(1);
  expect(assistant.sections[0]!.assignment_type).toBe('ASSISTANT_CLASS_TEACHER');
  expect(assistant.sections[0]!.section_id).toBe(teacher.sections[0]!.section_id);

  const context = await browser.newContext({
    baseURL: shells.app.baseURL,
    storageState: {
      cookies: assistant.storageState.cookies,
      origins: [
        {
          origin: shells.app.baseURL.replace(/\/$/, ''),
          localStorage: [
            {
              name: 'biddaloy:activeTenant',
              value: JSON.stringify({ tenantId: assistant.tenantId, role: assistant.role }),
            },
          ],
        },
      ],
    },
  });
  try {
    const page = await context.newPage();
    await page.goto('/my-class');
    const section = assistant.sections[0]!;
    await expect(page).toHaveURL(new RegExp(`/my-class/${section.section_id}$`));
    await expect(
      page.getByRole('heading', {
        level: 1,
        name: t('myClass.pageTitle', {
          section: `${section.class_name}-${section.section_name}`,
        }),
      }),
    ).toBeVisible();
  } finally {
    await context.close();
  }
});

test.describe('admin', () => {
  test.use(loggedIn('admin'));

  test('has no My class nav item and /my-class is the access-denied page', async ({ page }) => {
    await page.goto('/dashboard');
    await expect(page.getByRole('heading', { level: 1 }).first()).toBeVisible();
    await expect(page.getByRole('link', { name: t('nav.items.myClass') })).toHaveCount(0);

    await page.goto('/my-class');
    await expect(page.getByRole('heading', { name: t('common.accessDenied.title') })).toBeVisible();
  });
});

import { request as pwRequest, type APIRequestContext } from '@playwright/test';

import { adminApiSession, apiSession, get, isFridayAnywhere, markableDateIso, put } from '../api';
import { shells } from '../config';
import { expect, loggedIn, test } from '../fixtures/test';
import { t } from '../i18n';

/**
 * [84.4.4] Epic 84 close journey: the guardian asks, the class teacher answers in My class,
 * the teacher finalizes the register, and the arrival message is queued for the guardian.
 *
 * Why the last leg reads the communication history and not `/portal/notifications`: a PUSH
 * arrival notice goes to a browser push device (D44) and is never written to the alerts
 * worklist. The e2e guardian has no device (the log ends FAILED, NO_PUSH_DEVICE), so the push
 * log row is the observable proof that the notice was produced.
 *
 * Seed: `ensureArrivalSeed` gives `parent@biddaloy.test`'s roll-1 child (Class 6 A, the class
 * teacher's section) one ACTIVE row. Leg 1 switches it off and on again, which makes it
 * REQUESTED, so the whole story starts from "asked".
 */

interface MyChildren {
  school: { enabled: boolean };
  children: { student_id: string; student_name: string; subscription: { status: string } | null }[];
}
interface Register {
  session: { version: number; state: string };
  students: { student_id: string; roll_number: number }[];
}

const TODAY = markableDateIso();
const SETTINGS_KEY = 'attendance';

async function admin() {
  const api = await pwRequest.newContext({ baseURL: shells.app.baseURL });
  const password = process.env.SEED_ADMIN_PASSWORD;
  if (!password) throw new Error('SEED_ADMIN_PASSWORD is not set');
  return { api, session: await adminApiSession(api) };
}

async function setArrivalEnabled(api: APIRequestContext, enabled: boolean) {
  const session = await adminApiSession(api);
  const path = `/schools/${session.tenantId}/settings`;
  const cur = await get<{ version: number; attendance?: Record<string, unknown> }>(
    api,
    session,
    path,
  );
  const attendance = cur[SETTINGS_KEY] as { arrivalNotice?: object } | undefined;
  const res = await api.patch(`/api/v1${path}`, {
    headers: { Authorization: `Bearer ${session.token}`, 'X-Tenant-ID': session.tenantId },
    data: {
      version: cur.version,
      attendance: { ...attendance, arrivalNotice: { ...attendance?.arrivalNotice, enabled } },
    },
  });
  expect(res.ok(), `arrival switch: ${res.status()} ${await res.text()}`).toBe(true);
}

test.describe
  .serial('arrival notice: guardian asks -> teacher answers -> register -> message', () => {
  test.skip(isFridayAnywhere(), 'the school is closed on Friday; no register to finalize');

  let studentId = '';
  let finalizedHere = false;

  test.afterAll(async () => {
    const { api } = await admin();
    await setArrivalEnabled(api, false);
    await api.dispose();
  });

  test.describe('1. guardian asks', () => {
    test.use(loggedIn('parent'));

    test('switching the child off and on again leaves a waiting request', async ({
      page,
      request,
    }) => {
      const { api } = await admin();
      await setArrivalEnabled(api, true);
      await api.dispose();

      const parent = await apiSession(request, 'parent');
      const mine = await get<MyChildren>(request, parent, '/portal/arrival-subscriptions');
      // The seeded child: the one with a subscription row.
      const child = mine.children.find((c) => c.subscription !== null);
      expect(child, 'seeded arrival subscription is missing - has `yarn seed` run?').toBeTruthy();
      studentId = child!.student_id;

      await page.goto('/portal/attendance');
      // Two demo children share a name, so pick the row by its position in the card.
      const sw = page
        .getByRole('heading', { name: t('portal.arrivalNotice.title') })
        .locator('..')
        .getByRole('listitem')
        .nth(mine.children.indexOf(child!))
        .getByRole('switch');
      await expect(sw).toBeChecked();
      const offDone = page.waitForResponse(
        (r) => r.url().includes('/portal/arrival-subscriptions/') && r.request().method() === 'PUT',
      );
      await sw.click();
      await offDone;
      await expect(sw).not.toBeChecked();
      const onDone = page.waitForResponse(
        (r) => r.url().includes('/portal/arrival-subscriptions/') && r.request().method() === 'PUT',
      );
      await sw.click();
      await onDone;
      await expect(sw).toBeChecked();
      await expect(page.getByText(t('portal.arrivalNotice.status.waiting'))).toBeVisible();
    });
  });

  test.describe('2. teacher answers and finalizes', () => {
    test.use(loggedIn('teacher'));

    test('"every school day" in My class, then the register is finalized with the child present', async ({
      page,
      request,
    }) => {
      const teacher = await apiSession(request, 'teacher');
      const sections = await get<{ section_id: string }[]>(request, teacher, '/my-class/sections');
      const sectionId = sections[0]!.section_id;

      await page.goto(`/my-class/${sectionId}`);
      const card = page.getByRole('region', { name: t('myClass.cards.arrival') });
      await expect(card).toBeVisible();
      const answered = page.waitForResponse(
        (r) =>
          r.url().includes('/attendance/arrival-subscriptions/') &&
          r.request().method() === 'PATCH',
      );
      await card
        .getByRole('button', { name: t('myClass.arrival.everyDay') })
        .first()
        .click();
      expect((await answered).ok()).toBe(true);

      // Finalize today's register with everyone present (the API, as attendance.spec does).
      const register = await get<Register>(
        request,
        teacher,
        `/attendance/sections/${sectionId}/register?date=${TODAY}`,
      );
      // One register per section and day, and attendance specs finalize Class 6 / A too (the
      // notice is sent only by the finalize and only for today, so a rerun cannot resend).
      finalizedHere = register.session.state !== 'FINALIZED';
      test.skip(
        !finalizedHere,
        "today's register was finalized before this journey (rerun or an earlier spec)",
      );
      const saved = await put<{ session: { state: string } }>(
        request,
        teacher,
        `/attendance/sections/${sectionId}/register`,
        {
          date: TODAY,
          base_version: register.session.version,
          client_request_id: crypto.randomUUID(),
          finalize: true,
          // Each seeded student keeps their streak (roll 1 present, 2 late, 3 absent), so the My
          // class streaks card of other specs still has rows.
          entries: register.students.map((s) => ({
            student_id: s.student_id,
            status: { 2: 'LATE', 3: 'ABSENT' }[s.roll_number] ?? 'PRESENT',
          })),
        },
      );
      expect(saved.session.state).toBe('FINALIZED');
    });
  });

  test.describe('3. the message exists', () => {
    test.use(loggedIn('admin'));

    test("the child's communication history holds today's arrival notice", async ({ request }) => {
      test.skip(!finalizedHere, 'the register was not finalized by this journey');
      const session = await adminApiSession(request);
      // The history DTO has no trigger or body; a push log made in the last minutes for this
      // child is the arrival notice (nothing else messages this child on the seed).
      const logs = await get<{ medium: string; recipient_address: string; created_at: string }[]>(
        request,
        session,
        `/communications/student/${studentId}`,
      );
      const newest = logs[0];
      expect(newest, 'no communication log for the child').toBeTruthy();
      expect(newest!.medium).toBe('PUSH');
      expect(newest!.recipient_address).toMatch(/^push:/);
      expect(Date.now() - new Date(newest!.created_at).getTime()).toBeLessThan(5 * 60_000);
    });
  });
});

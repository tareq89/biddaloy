import { adminApiSession, createStudentsInSection, createTeacherForSection } from '../api';
import { shells } from '../config';
import { expect, test } from '../fixtures/test';
import { t } from '../i18n';

import { activeTenantId, readQueueRows, waitForOfflineDb, waitForSwControl } from './helpers';

/**
 * [9.6] Attendance marking is the real, first consumer of the 8.12
 * offline mutation queue — `enqueueMutation` is exercised here by
 * actually driving the marking screen, not by seeding IndexedDB (that
 * was only ever a stand-in until this screen existed —
 * `e2e/pwa/mutation-queue.spec.ts`'s own header comment).
 *
 * Journey: open the register online (so it's cached), go offline, mark
 * and submit, verify the write landed in the real queue with the real
 * request shape, reconnect, verify the replay actually reached the
 * server.
 */
test.describe('attendance offline marking', () => {
  test('a register marked offline queues, then replays on reconnect', async ({
    browser,
    request,
  }) => {
    const admin = await adminApiSession(request);
    const chain = await createStudentsInSection(request, admin, 'Offline Student', 3);
    const teacher = await createTeacherForSection(
      request,
      admin,
      'Offline Teacher',
      chain.sectionId,
    );

    const loginResponse = await request.post('/api/v1/auth/login', {
      data: { email: teacher.email, password: teacher.password },
    });
    if (!loginResponse.ok()) {
      throw new Error(`teacher login failed: ${loginResponse.status()}`);
    }
    const loginBody = (await loginResponse.json()) as {
      memberships: { tenantId: string; role: string }[];
    };
    const membership = loginBody.memberships[0];
    if (!membership) throw new Error('no membership for freshly-created teacher');
    const state = await request.storageState();

    const teacherContext = await browser.newContext({
      baseURL: shells.app.baseURL,
      storageState: {
        cookies: state.cookies,
        origins: [
          {
            origin: shells.app.baseURL.replace(/\/$/, ''),
            localStorage: [
              {
                name: 'biddaloy:activeTenant',
                value: JSON.stringify({ tenantId: membership.tenantId, role: membership.role }),
              },
            ],
          },
        ],
      },
    });
    const page = await teacherContext.newPage();
    const today = new Date().toISOString().slice(0, 10);

    await test.step('open the register online, so it is cached for the offline read', async () => {
      await page.goto(`/attendance/${chain.sectionId}?date=${today}`);
      await waitForSwControl(page);
      await waitForOfflineDb(page);
      await expect(page.getByText('Offline Student 01')).toBeVisible();
    });

    const tenantId = await activeTenantId(page);

    await test.step('go offline, mark everyone present, submit', async () => {
      await teacherContext.setOffline(true);
      await page.getByRole('button', { name: t('mark.allPresent') }).click();
      await page.getByRole('button', { name: t('mark.submitOffline') }).click();
      await expect(page.getByText(t('mark.queuedToast'))).toBeVisible();
    });

    await test.step('the write actually landed in the real queue, real shape', async () => {
      const rows = await readQueueRows(page);
      expect(rows).toHaveLength(1);
      expect(rows[0]?.tenantId).toBe(tenantId);
      expect(rows[0]?.entity).toBe('attendance');
      expect(rows[0]?.method).toBe('put');
      expect(rows[0]?.path).toBe(`/attendance/sections/${chain.sectionId}/register`);
      expect(rows[0]?.status).toBe('pending');
    });

    await test.step('reconnecting drains the queue', async () => {
      await teacherContext.setOffline(false);
      await expect
        .poll(() => readQueueRows(page).then((rows) => rows.length), {
          message: 'the queued PUT should have been sent and its row deleted',
          timeout: 30_000,
        })
        .toBe(0);
    });

    await test.step('the server actually has the register', async () => {
      const relogin = await request.post('/api/v1/auth/login', {
        data: { email: teacher.email, password: teacher.password },
      });
      const relogged = (await relogin.json()) as { access_token: string };
      const verified = await request.get(
        `/api/v1/attendance/sections/${chain.sectionId}/register`,
        {
          headers: {
            Authorization: `Bearer ${relogged.access_token}`,
            'X-Tenant-ID': membership.tenantId,
          },
          params: { date: today },
        },
      );
      if (!verified.ok()) {
        throw new Error(`GET register failed: ${verified.status()} ${await verified.text()}`);
      }
      const register = (await verified.json()) as { students: { status: string | null }[] };
      expect(register.students).toHaveLength(3);
      expect(register.students.every((s) => s.status === 'PRESENT')).toBe(true);
    });

    await test.step('and the sync chip returns to nothing at all once caught up', async () => {
      for (const label of [
        t('common.sync.needsAttention'),
        t('common.sync.pendingCount_one'),
        t('common.sync.offline'),
      ]) {
        await expect(page.getByRole('button', { name: label })).toHaveCount(0);
      }
    });
  });
});

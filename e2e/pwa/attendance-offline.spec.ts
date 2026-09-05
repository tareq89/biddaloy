import { adminApiSession, createStudentsInSection, createTeacherForSection } from '../api';
import { shells } from '../config';
import { expect, test } from '../fixtures/test';
import { t } from '../i18n';

import {
  activeTenantId,
  readQueueRows,
  seedQueueRow,
  waitForOfflineDb,
  waitForSwControl,
} from './helpers';

/**
 * [9.6] Attendance marking is the real, first consumer of the 8.12
 * offline mutation queue. This spec still SEEDS the queued row rather
 * than driving `context.setOffline(true)` + a live UI submit — the same
 * choice `e2e/pwa/mutation-queue.spec.ts` made, and for the documented
 * reason in its own header: Chrome DevTools Protocol's offline emulation
 * does not affect requests a *service worker* originates. Reproduced
 * here: with the SW controlling the page, a live PUT while
 * "offline" hangs indefinitely instead of failing over to the queue,
 * because CDP's offline flag never actually blocks it.
 *
 * Everything downstream of the seed is real: a real teacher, a real
 * section, the real replay engine, a real server, a real verification
 * that the register landed correctly.
 */
test.describe('attendance offline marking', () => {
  test('a register queued while offline replays on reconnect', async ({ browser, request }) => {
    const admin = await adminApiSession(request);
    const chain = await createStudentsInSection(request, admin, 'Offline Student', 3);
    const studentsResponse = await request.get('/api/v1/students', {
      headers: { Authorization: `Bearer ${admin.token}`, 'X-Tenant-ID': admin.tenantId },
      params: { section_id: chain.sectionId },
    });
    if (!studentsResponse.ok()) {
      throw new Error(`GET students failed: ${studentsResponse.status()}`);
    }
    const studentsBody = (await studentsResponse.json()) as { data: { id: string }[] };
    const studentIds = studentsBody.data.map((s) => s.id);
    expect(studentIds).toHaveLength(3);

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

    await test.step('the app is up and the offline machinery is ready', async () => {
      await page.goto('/dashboard');
      await waitForSwControl(page);
      await waitForOfflineDb(page);
    });

    const tenantId = await activeTenantId(page);

    await teacherContext.setOffline(true);

    await test.step('seed a real register-submit shape into the real queue', async () => {
      await seedQueueRow(page, {
        tenantId,
        entity: 'attendance',
        method: 'put',
        path: `/attendance/sections/${chain.sectionId}/register`,
        body: {
          date: today,
          base_version: 0,
          client_request_id: crypto.randomUUID(),
          entries: studentIds.map((student_id) => ({ student_id, status: 'PRESENT' })),
        },
      });
      const rows = await readQueueRows(page);
      expect(rows).toHaveLength(1);
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

import { adminApiSession } from '../api';
import { expect, loggedIn, test } from '../fixtures/test';
import { t } from '../i18n';

import {
  activeTenantId,
  createStudentInOwnSection,
  fetchStudent,
  readQueueRows,
  seedQueueRow,
  waitForOfflineDb,
  waitForSwControl,
} from './helpers';

/**
 * [8.12.6] AC 3, 5 and 6 — a queued mutation replays on reconnect, the
 * queue survives a full app restart, and a conflict is handled rather
 * than silently overwritten.
 *
 * ## Why these specs seed IndexedDB instead of clicking something
 *
 * Nothing in the product enqueues a mutation yet. `enqueueMutation` has
 * no caller: its intended first consumer is client-teacher attendance,
 * and neither that app nor the attendance endpoints exist
 * (`ui/src/api/mutation-queue.ts`'s header). The *replay engine*,
 * however, ships and runs on every `online` event — and #184 found the
 * hard way that an engine nobody starts looks exactly like an engine that
 * works. So the input is seeded (`seedQueueRow`) and everything after it
 * is real: the real Dexie database, the real `online` transition, the
 * real `apiClient`, real endpoints, a real server.
 *
 * The seeded rows deliberately target **non-money** paths only, and must
 * continue to. Seeding bypasses both of `enqueueMutation`'s guards, so a
 * copy-pasted spec pointing at `/payments` would "prove" a replayed
 * payment works — the single behaviour the queue exists to prevent.
 *
 * Every row carries `entity: 'attendance'` because that is the only
 * member of `QueueableEntity` and the only key `sync.entity.*` has a
 * label for. The path is what varies.
 */
test.describe('offline mutation queue', () => {
  test.use(loggedIn('admin'));

  test('a mutation queued while offline replays on reconnect', async ({
    page,
    context,
    request,
  }) => {
    const session = await adminApiSession(request);
    const { studentId } = await createStudentInOwnSection(
      request,
      session,
      `Queue Replay ${Date.now()}`,
    );
    const address = `e2e-offline-${Date.now()}`;

    await page.goto('/dashboard');
    await waitForSwControl(page);
    const tenantId = await activeTenantId(page);
    await waitForOfflineDb(page);

    await context.setOffline(true);
    await seedQueueRow(page, {
      tenantId,
      method: 'patch',
      // `home_address` — the real `UpdateStudentDto` field
      // (`server/src/modules/students/dto/students.dto.ts`).
      path: `/students/${studentId}`,
      body: { home_address: address },
    });

    await test.step('offline, the row just sits there', async () => {
      const rows = await readQueueRows(page);
      expect(rows).toHaveLength(1);
      expect(rows[0]?.status).toBe('pending');
      // Being offline is not a strike — `runReplay` leaves the row
      // untouched rather than burning an attempt.
      expect(rows[0]?.attempts).toBe(0);
    });

    await test.step('reconnecting drains the queue', async () => {
      // `setOffline(false)` fires the browser's own `online` event, which
      // is what `startQueueReplay`'s listener is waiting for. Nothing in
      // the test pokes the engine.
      await context.setOffline(false);
      await expect
        .poll(() => readQueueRows(page).then((rows) => rows.length), {
          message: 'the queued PATCH should have been sent and its row deleted',
          timeout: 30_000,
        })
        .toBe(0);
    });

    await test.step('the server actually has the change', async () => {
      const student = await fetchStudent(request, session, studentId);
      expect(student.home_address).toBe(address);
    });

    await test.step('and the indicator says nothing at all', async () => {
      // Anti-furniture rule (`sync-status.tsx`): online, empty and
      // readable renders no chip. Asserted as an absence for each state
      // the chip could be in, so a leftover "1 waiting to send" fails
      // here rather than being read as "no chip".
      for (const label of [
        t('common.sync.needsAttention'),
        t('common.sync.pendingCount_one'),
        t('common.sync.offline'),
      ]) {
        await expect(page.getByRole('button', { name: label })).toHaveCount(0);
      }
      // The `sync.allSaved` announcement is deliberately *not* asserted.
      // Its live region latches on the first render that sees a non-empty
      // snapshot, and a row written straight into IndexedDB is never in a
      // rendered snapshot before replay deletes it — so its absence here
      // is a fact about seeding, not about the component. It is covered
      // where it can be driven honestly: `ui/src/components/sync-status.test.tsx`.
    });
  });

  test('a conflict stops the queue, blocks later rows, and survives a restart', async ({
    page,
    context,
    request,
  }) => {
    const session = await adminApiSession(request);
    const { studentId, classId, sectionId } = await createStudentInOwnSection(
      request,
      session,
      `Queue Conflict ${Date.now()}`,
    );
    const blockedAddress = `e2e-blocked-${Date.now()}`;

    await page.goto('/dashboard');
    await waitForSwControl(page);
    const tenantId = await activeTenantId(page);
    await waitForOfflineDb(page);

    await context.setOffline(true);

    // A genuine server 409, not a faked one: deleting a section that
    // still has an active student in it is
    // `classes.service.ts`'s own `ConflictException`. `students` has no
    // 409 path at all, and faking one with `context.route()` is not an
    // option here — route interception cannot see requests a service
    // worker makes.
    await seedQueueRow(page, {
      tenantId,
      method: 'delete',
      path: `/classes/${classId}/sections/${sectionId}`,
    });
    // Queued *after* the conflicting row, so head-of-line blocking means
    // it must never be sent.
    await seedQueueRow(page, {
      tenantId,
      method: 'patch',
      path: `/students/${studentId}`,
      body: { home_address: blockedAddress },
    });

    await context.setOffline(false);

    await test.step('the 409 is recorded as a conflict, not retried away', async () => {
      await expect
        .poll(() => readQueueRows(page).then((rows) => rows[0]?.status), { timeout: 30_000 })
        .toBe('conflict');
      const rows = await readQueueRows(page);
      expect(rows[0]?.lastError?.statusCode).toBe(409);
      // Not dead-lettered, not silently dropped: a human decides.
      expect(rows[0]?.attempts).toBe(0);
    });

    await test.step('the row behind it is held back, not applied out of order', async () => {
      const rows = await readQueueRows(page);
      expect(rows).toHaveLength(2);
      expect(rows[1]?.status).toBe('pending');
      const student = await fetchStudent(request, session, studentId);
      expect(student.home_address ?? null).not.toBe(blockedAddress);
    });

    await test.step('the indicator asks for attention', async () => {
      await expect(
        page.getByRole('button', { name: t('common.sync.needsAttention') }),
      ).toBeVisible();
    });

    await test.step('and all of it survives closing and reopening the app', async () => {
      // A real restart: the tab is destroyed, taking the in-memory
      // snapshot, the query cache and the access token with it. Only
      // IndexedDB (and the refresh cookie) survive, which is the whole
      // claim being tested.
      await page.close();
      const restarted = await context.newPage();
      await restarted.goto('/dashboard');
      await waitForSwControl(restarted);

      const rows = await readQueueRows(restarted);
      expect(rows).toHaveLength(2);
      expect(rows[0]?.status).toBe('conflict');
      expect(rows[1]?.status).toBe('pending');
      // The cold snapshot is rebuilt from Dexie once the tenant is known,
      // so the restored tab shows the same unfinished work.
      await expect(
        restarted.getByRole('button', { name: t('common.sync.needsAttention') }),
      ).toBeVisible();
    });
  });
});

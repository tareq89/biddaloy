import { ExamComponentKind, ExamComponentSource, ExamKind } from '@biddaloy/shared';

import {
  adminApiSession,
  createClassSection,
  createGuardian,
  currentAcademicYear,
  newClassSubject,
  patch,
  post,
  submitMarkSheet,
} from '../api';
import { expect, loggedIn, test } from '../fixtures/test';
import { t } from '../i18n';

/**
 * [80.3.0x] Epic 80 wave-3 close: marks SMS for one SUBMITTED grid, in a real browser.
 *
 * Own data (shard-friendly): a fresh class and section in the current year, one student with a
 * guardian who has a phone, a fresh subject and a fresh exam whose one marks list is submitted
 * over the API. Nothing else touches this grid, so the first send always has one message to
 * queue and the second visit always finds it sent.
 *
 * The signed-in admin sends (the admin holds MARKS_SMS_SEND for every grid); a Teacher needs a
 * subject-teacher assignment first, which no e2e helper builds, so the teacher leg is covered
 * by the server integration spec and the web unit tests.
 *
 * The e2e school has no SMS gateway, so the message's settled status differs by environment
 * (a local sink marks it SENT; CI's worker fails it and RELEASES the dedupe key so the pair can
 * be sent again) — the spec polls the message log until the row is terminal and asserts the
 * page state that status requires.
 *
 * Not run in this lane (no stack): written against the real labels in
 * ui/src/i18n/locales/{en,bn}/marksSms.json and type-checked.
 */
test.use(loggedIn('admin'));

test('send marks SMS from a submitted grid; the second visit reflects the message log', async ({
  page,
  request,
}) => {
  test.setTimeout(120_000);
  const session = await adminApiSession(request);
  const year = await currentAcademicYear(request, session);
  const chain = await createClassSection(request, session, year);
  const stamp = Date.now();
  const phone = `017${String(stamp).slice(-8)}`;
  const guardian = await createGuardian(request, session, `Marks Guardian ${stamp}`, phone);
  const studentName = `Marks Student ${stamp}`;
  const student = await post<{ id: string }>(request, session, '/students', {
    full_name: studentName,
    class_section_id: chain.sectionId,
    guardian_ids: [guardian.id],
  });
  const subject = await newClassSubject(request, session, chain.classId, year.id);
  const exam = await post<{ id: string }>(request, session, '/exams', {
    name: `E2E Marks SMS ${stamp}`,
    kind: ExamKind.TERM,
    academic_year_id: year.id,
    class_id: chain.classId,
  });
  const component = await post<{ id: string }>(request, session, `/exams/${exam.id}/components`, {
    subject_id: subject.id,
    name: 'Written',
    kind: ExamComponentKind.WRITTEN,
    source: ExamComponentSource.MANUAL,
    full_marks: '100.00',
    pass_marks: '33.00',
    sequence: 1,
  });
  await patch(request, session, `/exams/${exam.id}/marks`, {
    section_id: chain.sectionId,
    subject_id: subject.id,
    cells: [
      { student_id: student.id, component_id: component.id, value: '85.00', status: 'PRESENT' },
    ],
  });
  await submitMarkSheet(request, session, exam.id, {
    section_id: chain.sectionId,
    subject_id: subject.id,
  });

  await test.step('the submitted grid offers the marks SMS button', async () => {
    await page.goto(`/marks/${exam.id}/${chain.sectionId}/${subject.id}`);
    const previewed = page.waitForResponse(
      (r) =>
        r.request().method() === 'POST' && /\/marks\/[^/]+\/[^/]+\/sms\/preview$/.test(r.url()),
    );
    await page.getByRole('button', { name: t('marksSms.button') }).click();
    await expect(page).toHaveURL(
      new RegExp(`/marks/${exam.id}/${chain.sectionId}/${subject.id}/sms$`),
    );
    // The one marked student has one reachable guardian: the review counts one.
    expect(await (await previewed).json()).toMatchObject({ count: 1 });
  });

  const send = page.getByRole('button', { name: t('marksSms.send'), exact: true });

  await test.step('the review finds the one guardian, then Send queues it', async () => {
    // The preview already ran on load; wait for the button to be live.
    await expect(send).toBeEnabled({ timeout: 15_000 });
    const sent = page.waitForResponse(
      (r) => r.request().method() === 'POST' && /\/marks\/[^/]+\/[^/]+\/sms$/.test(r.url()),
    );
    await send.click();
    expect(await (await sent).json()).toMatchObject({ queued: 1 });
    // The send button is gone once it went out.
    await expect(send).toHaveCount(0);
  });

  await test.step('the message log settles, and the second visit reflects it', async () => {
    // The delivery outcome differs by environment (a local sink marks the
    // message SENT; CI has no gateway, so the worker fails it and releases
    // the dedupe key for a retry) — poll the message log until the row is
    // terminal so the reload cannot race the worker, then assert whichever
    // settled state the page must show.
    let status = 'pending';
    await expect
      .poll(
        async () => {
          const res = await request.get('/api/v1/communications/logs?limit=50', {
            headers: { 'X-Tenant-ID': session.tenantId, Authorization: `Bearer ${session.token}` },
          });
          if (!res.ok()) return (status = `logs ${res.status()}`);
          const body = (await res.json()) as {
            data?: { status: string; message_body?: string }[];
          };
          const mine = (body.data ?? []).find((log) => log.message_body?.includes(studentName));
          status = mine?.status ?? 'row not found yet';
          // Terminal: SENT/DELIVERED (a local sink delivered it) or FAILED (no
          // gateway — the failure released the dedupe key for a retry).
          return ['SENT', 'DELIVERED', 'FAILED'].includes(status);
        },
        { timeout: 30_000 },
      )
      .toBe(true);

    const previewed = page.waitForResponse(
      (r) =>
        r.request().method() === 'POST' && /\/marks\/[^/]+\/[^/]+\/sms\/preview$/.test(r.url()),
    );
    await page.reload();
    await previewed;

    if (status === 'FAILED') {
      // No gateway in CI: worker fails the row and releases the dedupe key, so
      // the same recipients are sendable again.
      await expect(page.getByText(t('marksSms.alreadySentNote'))).toHaveCount(0);
      await expect(send).toBeEnabled({ timeout: 30_000 });
    } else {
      // SENT/DELIVERED: the visit reads "already sent" and send stays disabled.
      await expect(page.getByText(t('marksSms.alreadySentNote'))).toBeVisible({
        timeout: 30_000,
      });
      await expect(send).toBeDisabled();
    }
  });
});

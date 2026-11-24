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
 * The e2e school has no SMS gateway, so the message is queued and later fails in the worker;
 * the page only claims "on its way", and the dedupe key is kept at send time, so the second
 * visit still reads "already sent".
 *
 * Not run in this lane (no stack): written against the real labels in
 * ui/src/i18n/locales/{en,bn}/marksSms.json and type-checked.
 */
test.use(loggedIn('admin'));

test('send marks SMS from a submitted grid, then it says already sent', async ({
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
  const student = await post<{ id: string }>(request, session, '/students', {
    full_name: `Marks Student ${stamp}`,
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

  await test.step('opening it again says it was already sent', async () => {
    const previewed = page.waitForResponse(
      (r) =>
        r.request().method() === 'POST' && /\/marks\/[^/]+\/[^/]+\/sms\/preview$/.test(r.url()),
    );
    await page.reload();
    await previewed;
    // The note renders after the preview resolves; on a loaded CI runner the
    // whole page can stall well past 30s.
    await expect(page.getByText(t('marksSms.alreadySentNote'))).toBeVisible({
      timeout: 60_000,
    });
    await expect(send).toBeDisabled({ timeout: 60_000 });
  });
});

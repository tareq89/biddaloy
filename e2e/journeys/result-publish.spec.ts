import { ExamComponentKind, ExamComponentSource, ExamKind } from '@biddaloy/shared';
import { adminApiSession, get, post } from '../api';
import { expect, loggedIn, test } from '../fixtures/test';
import { t } from '../i18n';
import { DetailShellPage } from '../pages/detail-shell';

/**
 * [19.10.1] Process -> review -> publish, cross-role: an admin computes and
 * publishes an exam's results, then the seeded guardian (`parent@biddaloy.test`,
 * `loggedIn('parent')`) sees the result in the portal. Covers the issue's
 * step 5 journey. Runs in `bn` locale (this suite's default,
 * `DEFAULT_LOCALE` in `e2e/i18n.ts`) — every assertion below resolves its
 * text through the app's own message catalog rather than hardcoding
 * English, so it holds in either locale.
 *
 * Uses the *seeded* Class 6 / section A roll 1 student — `parent@biddaloy.test`'s
 * one linked child (`seed.util.ts`'s `ensureDemoStudents` docstring) —
 * rather than a freshly created guardian: nothing in this codebase mints a
 * portal-login-capable guardian account through the API (guardians are not
 * users), so a fresh guardian would have no way to log in at all. Reusing
 * the seeded parent's real linked child lets this spec attach a fresh exam
 * to a student a real guardian session can already see.
 */

interface SeededStudent {
  id: string;
  full_name: string;
  roll_number: number;
  class_section_id: string;
  class_id: string;
  academic_year_id: string;
}

const SEEDED_CLASS_NAME = 'Class 6';
const SEEDED_SECTION_NAME = 'A';

async function findSeededRollOne(
  request: Parameters<typeof adminApiSession>[0],
  session: Awaited<ReturnType<typeof adminApiSession>>,
): Promise<SeededStudent> {
  // `/classes` and `/students` are paginated (`{ data, total, ... }`);
  // `/classes/:id/sections` is a plain array.
  const { data: classes } = await get<{
    data: { id: string; name: string; academic_year_id: string }[];
  }>(request, session, '/classes?limit=100');
  const classMatches = classes.filter((c) => c.name === SEEDED_CLASS_NAME);
  for (const klass of classMatches) {
    const sections = await get<{ id: string; section_name: string }[]>(
      request,
      session,
      `/classes/${klass.id}/sections`,
    );
    const section = sections.find((s) => s.section_name === SEEDED_SECTION_NAME);
    if (!section) continue;
    const { data: students } = await get<{
      data: Omit<SeededStudent, 'class_section_id' | 'class_id' | 'academic_year_id'>[];
    }>(request, session, `/students?section_id=${section.id}&limit=100`);
    const rollOne = students.find((s) => s.roll_number === 1);
    if (rollOne) {
      return {
        ...rollOne,
        class_section_id: section.id,
        class_id: klass.id,
        academic_year_id: klass.academic_year_id,
      };
    }
  }
  throw new Error(
    `Seeded ${SEEDED_CLASS_NAME} / ${SEEDED_SECTION_NAME} roll 1 not found — has \`yarn seed\` run?`,
  );
}

test.describe.serial('exams: admin publishes -> guardian sees it in the portal', () => {
  let examName: string;

  test.describe('1. admin processes and publishes', () => {
    test.use(loggedIn('admin'));

    test('process, review, publish an exam for the seeded roll 1', async ({ page, request }) => {
      const session = await adminApiSession(request);
      const student = await findSeededRollOne(request, session);

      const subject = await post<{ id: string }>(request, session, '/subjects', {
        code: `E2EPUB-${Date.now().toString(36).toUpperCase()}`,
        name_en: 'E2E Publish Subject',
        name_bn: 'ই২ই প্রকাশ বিষয়',
      });

      examName = `E2E Publish Exam ${Date.now()}`;
      const exam = await post<{ id: string }>(request, session, '/exams', {
        name: examName,
        kind: ExamKind.TERM,
        academic_year_id: student.academic_year_id,
        class_id: student.class_id,
      });

      const component = await post<{ id: string }>(
        request,
        session,
        `/exams/${exam.id}/components`,
        {
          subject_id: subject.id,
          name: 'Written',
          kind: ExamComponentKind.WRITTEN,
          source: ExamComponentSource.MANUAL,
          full_marks: '100.00',
          pass_marks: '33.00',
          sequence: 1,
        },
      );

      // Batch-enter and submit the one mark this exam needs, through the
      // API — the marks-entry UI itself is `marks-entry.spec.ts`'s job.
      const marksResponse = await request.patch(`/api/v1/exams/${exam.id}/marks`, {
        headers: { Authorization: `Bearer ${session.token}`, 'X-Tenant-ID': session.tenantId },
        data: {
          section_id: student.class_section_id,
          subject_id: subject.id,
          cells: [
            {
              student_id: student.id,
              component_id: component.id,
              value: '92.00',
              status: 'PRESENT',
            },
          ],
        },
      });
      if (!marksResponse.ok()) {
        throw new Error(
          `PATCH marks failed: ${marksResponse.status()} ${await marksResponse.text()}`,
        );
      }
      await post(request, session, `/exams/${exam.id}/marks/submit`, {
        section_id: student.class_section_id,
        subject_id: subject.id,
      });

      await page.goto(`/exams/${exam.id}`);
      await expect(page.getByRole('heading', { name: examName })).toBeVisible();
      // The detail page opens on Progress; Process/Publish live on Results.
      await new DetailShellPage(page).openTab('exams.detail.tabs.results', 'results');

      await test.step('process', async () => {
        await page.getByRole('button', { name: t('exams.resultsPanel.process') }).click();
        await expect(
          page.getByRole('heading', { name: t('exams.processDialog.title') }),
        ).toBeVisible();
        await page.getByRole('button', { name: t('exams.processDialog.confirm') }).click();
        await expect(
          page.getByRole('button', { name: t('exams.resultsPanel.publish') }),
        ).toBeVisible();
      });

      await test.step('review the computed result', async () => {
        await expect(page.getByText(student.full_name)).toBeVisible();
      });

      await test.step('publish', async () => {
        await page.getByRole('button', { name: t('exams.resultsPanel.publish') }).click();
        await expect(
          page.getByRole('heading', { name: t('exams.publishDialog.title') }),
        ).toBeVisible();
        await page.getByRole('button', { name: t('exams.publishDialog.confirm') }).click();
        await expect(
          page.getByRole('button', { name: t('exams.resultsPanel.reopen') }),
        ).toBeVisible();
      });
    });
  });

  test.describe('2. guardian sees the published result in the portal', () => {
    test.use(loggedIn('parent'));

    test('the newly published exam appears on the linked child', async ({ page }) => {
      await page.goto('/portal/results');
      await expect(page.getByRole('heading', { name: t('portal.results.title') })).toBeVisible();
      await expect(page.getByText(examName)).toBeVisible();
    });
  });
});

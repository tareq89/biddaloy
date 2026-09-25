import { ExamStatus } from '@biddaloy/shared';
import {
  classSectionFactory,
  cleanupTestState,
  examFactory,
  renderWithRouter,
  server,
} from '@biddaloy/ui/test';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { afterEach, describe, expect, it } from 'vitest';

import { routeTree } from '../../../routeTree.gen';

const MERIT_ROW = {
  student_id: 'stu-1',
  roll_number: 1,
  full_name: 'Rahim Uddin',
  section_id: 'sec-1',
  section_name: 'Six - A',
  total_marks: 450,
  gpa: 4.5,
  grade: 'A',
  position: 1,
  section_position: 1,
  is_fail: false,
};

const DEFAULTED_ROW = {
  ...MERIT_ROW,
  student_id: 'stu-2',
  roll_number: 2,
  full_name: 'Karim Sheikh',
  is_fail: true,
  failed_subjects: [{ subject_id: 'subj-1', name: 'Math' }],
  absent_subjects: [{ subject_id: 'subj-2', name: 'Physics' }],
};

const PASS_FAIL_BODY = {
  status: ExamStatus.PROCESSED,
  subjects: [
    {
      subject_id: 'subj-1',
      subject_name: 'Math',
      appeared: 30,
      passed: 25,
      failed: 5,
      absent: 0,
      pass_pct: 83.3,
      highest: 98,
      average: 72.5,
      grade_distribution: { A: 10, B: 15, F: 5 },
    },
  ],
  overall: {
    subject_id: null,
    subject_name: 'Overall',
    appeared: 30,
    passed: 25,
    failed: 5,
    absent: 0,
    pass_pct: 83.3,
    highest: 98,
    average: 72.5,
    grade_distribution: { A: 10, B: 15, F: 5 },
  },
};

const PASS_FAIL_COMPONENT_BODY = {
  status: ExamStatus.PROCESSED,
  rows: [
    {
      subject_id: 'subj-1',
      subject_name: 'Math',
      component_id: 'comp-1',
      component_name: 'Written',
      sequence: 1,
      appeared: 30,
      absent: 0,
      below_pass: 5,
      highest: 98,
      average: 72.5,
    },
  ],
};

function mockExam(overrides: Parameters<typeof examFactory>[0] = {}) {
  const exam = examFactory({
    id: 'exam-1',
    name: 'Half Yearly 2026',
    status: ExamStatus.PROCESSED,
    ...overrides,
  });
  const section = classSectionFactory({ id: 'sec-1', class: exam.class, section_name: 'A' });
  server.use(
    http.get('/api/v1/exams', () =>
      HttpResponse.json({ data: [exam], total: 1, page: 1, limit: 50, totalPages: 1 }),
    ),
    http.get(`/api/v1/classes/${exam.class_id}/sections`, () => HttpResponse.json([section])),
    http.get(`/api/v1/exams/${exam.id}/analysis/merit`, () =>
      HttpResponse.json({ status: exam.status, rows: [MERIT_ROW] }),
    ),
    http.get(`/api/v1/exams/${exam.id}/analysis/defaulted`, () =>
      HttpResponse.json({ status: exam.status, rows: [DEFAULTED_ROW] }),
    ),
    http.get(`/api/v1/exams/${exam.id}/analysis/pass-fail`, () =>
      HttpResponse.json(PASS_FAIL_BODY),
    ),
    http.get(`/api/v1/exams/${exam.id}/analysis/pass-fail/components`, () =>
      HttpResponse.json(PASS_FAIL_COMPONENT_BODY),
    ),
  );
  return exam;
}

describe('/analysis', () => {
  afterEach(async () => {
    await cleanupTestState();
  });

  it('switching tabs updates the URL', async () => {
    const user = userEvent.setup();
    const exam = mockExam();
    const { router } = renderWithRouter(routeTree, {
      initialEntries: [`/analysis?examId=${exam.id}&tab=merit`],
      tenantId: 'tenant-1',
      role: 'ADMIN',
      locale: 'en',
    });

    const defaultersTab = await screen.findByRole('tab', { name: 'Defaulters' });
    await user.click(defaultersTab);

    await waitFor(() => {
      expect(router.state.location.search).toMatchObject({ tab: 'defaulted' });
    });
  });

  it('merit shows section position when a section is chosen', async () => {
    const exam = mockExam();
    renderWithRouter(routeTree, {
      initialEntries: [`/analysis?examId=${exam.id}&sectionId=sec-1&tab=merit`],
      tenantId: 'tenant-1',
      role: 'ADMIN',
      locale: 'en',
    });

    await screen.findByText('Section position');
  });

  it('defaulted reasons render', async () => {
    const exam = mockExam();
    renderWithRouter(routeTree, {
      initialEntries: [`/analysis?examId=${exam.id}&tab=defaulted`],
      tenantId: 'tenant-1',
      role: 'ADMIN',
      locale: 'en',
    });

    await screen.findByText(/Failed: Math/);
    await screen.findByText(/Absent: Physics/);
  });

  it('the by-component toggle swaps the table', async () => {
    const user = userEvent.setup();
    const exam = mockExam();
    renderWithRouter(routeTree, {
      initialEntries: [`/analysis?examId=${exam.id}&tab=pass-fail`],
      tenantId: 'tenant-1',
      role: 'ADMIN',
      locale: 'en',
    });

    await screen.findByText('Math');
    expect(screen.queryByText('Written')).toBeNull();

    await user.click(screen.getByRole('checkbox', { name: 'By component' }));

    await screen.findByText('Written');
  });

  it('shows the DRAFT exam empty state', async () => {
    const exam = mockExam({ status: ExamStatus.DRAFT });
    renderWithRouter(routeTree, {
      initialEntries: [`/analysis?examId=${exam.id}&tab=merit`],
      tenantId: 'tenant-1',
      role: 'ADMIN',
      locale: 'en',
    });

    await screen.findByText('Process results first.');
    within(screen.getByRole('button', { name: 'Process result' }));
  });
});

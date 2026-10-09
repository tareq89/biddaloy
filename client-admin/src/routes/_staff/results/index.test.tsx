/**
 * [31.4.marks-2] `/results`: labelled exam picker, the exam's status badge
 * and one-line next step. The panel's own buttons are covered by
 * `exams/-detail/results-panel.test.tsx`.
 */
import { cleanupTestState, examFactory, renderWithRouter, server } from '@biddaloy/ui/test';
import { screen } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { afterEach, describe, expect, it } from 'vitest';

import { routeTree } from '../../../routeTree.gen';

function mockExams(exams: ReturnType<typeof examFactory>[]) {
  server.use(
    http.get('/api/v1/exams', () =>
      HttpResponse.json({
        data: exams,
        total: exams.length,
        page: 1,
        limit: 50,
        totalPages: 1,
      }),
    ),
    http.get(/\/api\/v1\/exams\/[^/]+\/results$/, () =>
      HttpResponse.json({ data: [], total: 0, page: 1, limit: 25, totalPages: 0 }),
    ),
  );
}

const render = () =>
  renderWithRouter(routeTree, {
    initialEntries: ['/results'],
    tenantId: 'tenant-1',
    role: 'ADMIN',
    locale: 'en',
  });

describe('/results', () => {
  afterEach(async () => {
    await cleanupTestState();
  });

  it('labels the picker and names the class in the option text', async () => {
    const exam = examFactory({ id: 'exam-1', name: 'Half Yearly', status: 'PROCESSED' });
    mockExams([exam]);
    render();

    const picker = await screen.findByLabelText('Exam');
    expect(picker.textContent).toContain(`${exam.name} · ${exam.class?.name}`);
  });

  it('shows the Processed badge and its next step', async () => {
    mockExams([examFactory({ id: 'exam-1', status: 'PROCESSED' })]);
    render();

    await screen.findByText(
      'Check the results, then publish. Guardians see them after publishing.',
    );
    expect(screen.getAllByText('Processed').length).toBeGreaterThan(0);
  });

  it('shows the Draft and Published next steps for those exams', async () => {
    mockExams([examFactory({ id: 'exam-1', status: 'DRAFT' })]);
    const first = render();
    await screen.findByText('Work out the results once every marks list is submitted.');
    first.unmount();

    mockExams([examFactory({ id: 'exam-1', status: 'PUBLISHED' })]);
    render();
    await screen.findByText('Guardians can see these results.');
    expect(screen.getAllByText('Published').length).toBeGreaterThan(0);
  });

  it('shows "No exams yet" and no picker when there are no exams', async () => {
    mockExams([]);
    render();

    await screen.findByText('No exams yet');
    expect(screen.queryByLabelText('Exam')).toBeNull();
  });
});

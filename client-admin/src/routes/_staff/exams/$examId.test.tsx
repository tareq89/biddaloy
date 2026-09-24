import { cleanupTestState, examFactory, renderWithRouter, server } from '@biddaloy/ui/test';
import { screen } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { afterEach, describe, expect, it } from 'vitest';

import { routeTree } from '../../../routeTree.gen';

/** [19.6.1] Exam detail — Progress is the DEFAULT tab (issue rule #3). */
describe('/exams/$examId', () => {
  afterEach(async () => {
    await cleanupTestState();
  });

  it('lands on the Progress tab by default', async () => {
    const exam = examFactory({ id: 'exam-1', name: 'Half Yearly 2026' });
    server.use(
      http.get('/api/v1/exams/:id', () => HttpResponse.json(exam)),
      http.get('/api/v1/exams/:examId/marks/progress', () =>
        HttpResponse.json({ counts: { DRAFT: 2, SUBMITTED: 8 }, outstanding: [] }),
      ),
    );

    renderWithRouter(routeTree, {
      initialEntries: ['/exams/exam-1'],
      tenantId: 'tenant-1',
      role: 'ADMIN',
      locale: 'en',
    });

    await screen.findByRole('heading', { name: 'Half Yearly 2026' });
    const progressTab = screen.getByRole('tab', { name: 'Progress' });
    expect(progressTab.getAttribute('aria-selected')).toBe('true');
    await screen.findByText('8 of 10 grids submitted');
  });
});

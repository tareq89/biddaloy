import { cleanupTestState, examFactory, renderWithRouter, server } from '@biddaloy/ui/test';
import { screen } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { afterEach, describe, expect, it } from 'vitest';

import { routeTree } from '../../../routeTree.gen';

describe('/marks', () => {
  afterEach(async () => {
    await cleanupTestState();
  });

  it('lists outstanding grids for the selected exam, linking into the entry page', async () => {
    const exam = examFactory({ id: 'exam-1', name: 'Half Yearly 2026' });
    server.use(
      http.get('/api/v1/exams', () =>
        HttpResponse.json({ data: [exam], total: 1, page: 1, limit: 50, totalPages: 1 }),
      ),
      http.get('/api/v1/exams/exam-1/marks/progress', () =>
        HttpResponse.json({
          counts: { DRAFT: 1, SUBMITTED: 0 },
          outstanding: [
            { section_id: 'sec-1', section_name: 'Six - A', subject_id: 'subj-1', state: 'DRAFT' },
          ],
        }),
      ),
    );

    renderWithRouter(routeTree, {
      initialEntries: ['/marks'],
      tenantId: 'tenant-1',
      role: 'TEACHER',
      locale: 'en',
    });

    await screen.findByRole('heading', { name: 'Marks entry' });
    const link = await screen.findByRole('link', { name: 'Six - A' });
    expect(link.getAttribute('href')).toBe('/marks/exam-1/sec-1/subj-1');
  });

  it('shows the empty message when nothing is outstanding', async () => {
    const exam = examFactory({ id: 'exam-2', name: 'Model Test' });
    server.use(
      http.get('/api/v1/exams', () =>
        HttpResponse.json({ data: [exam], total: 1, page: 1, limit: 50, totalPages: 1 }),
      ),
      http.get('/api/v1/exams/exam-2/marks/progress', () =>
        HttpResponse.json({ counts: { DRAFT: 0, SUBMITTED: 0 }, outstanding: [] }),
      ),
    );

    renderWithRouter(routeTree, {
      initialEntries: ['/marks'],
      tenantId: 'tenant-1',
      role: 'TEACHER',
      locale: 'en',
    });

    await screen.findByText('No grids for this exam yet — check back once components are set up.');
  });
});

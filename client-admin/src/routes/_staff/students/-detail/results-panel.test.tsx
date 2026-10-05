import { cleanupTestState, renderWithRouter, server, studentFactory } from '@biddaloy/ui/test';
import { screen } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { afterEach, describe, expect, it } from 'vitest';

import { routeTree } from '../../../../routeTree.gen';

/** [19.9.1] Staff results panel — every exam, unpublished ones labelled so
 * staff never mistake an unpublished grade for one a parent can see. */
function renderPanel() {
  // The panel renders router links, so it is mounted through the real route.
  server.use(
    http.get('/api/v1/students/:id', () => HttpResponse.json(studentFactory({ id: 'student-1' }))),
    http.get('/api/v1/students/:studentId/promotion-overrides', () => HttpResponse.json([])),
  );
  return renderWithRouter(routeTree, {
    initialEntries: ['/students/student-1?tab=results'],
    locale: 'en',
    role: 'ADMIN',
    tenantId: 'tenant-1',
  });
}

describe('ResultsPanel', () => {
  afterEach(async () => {
    await cleanupTestState();
  });

  it('shows every exam, labelling the unpublished one', async () => {
    server.use(
      http.get('/api/v1/students/:studentId/results', () =>
        HttpResponse.json([
          {
            exam_id: 'exam-published',
            exam_name: 'First Term Exam',
            exam_kind: 'TERM',
            published: true,
            total_marks: 450,
            gpa: 5.0,
            grade: 'A+',
            position: 1,
            is_fail: false,
          },
          {
            exam_id: 'exam-unpublished',
            exam_name: 'Monthly Test',
            exam_kind: 'MONTHLY',
            published: false,
            total_marks: 60,
            gpa: 3.0,
            grade: 'B',
            position: 2,
            is_fail: false,
          },
        ]),
      ),
    );

    renderPanel();

    expect(await screen.findByText('First Term Exam')).toBeTruthy();
    expect(screen.getByText('Monthly Test')).toBeTruthy();
    expect(screen.getByText('Not yet published')).toBeTruthy();
    expect(screen.getByText('Published')).toBeTruthy();
    expect(screen.getAllByRole('link', { name: 'View result' })[0]?.getAttribute('href')).toBe(
      '/results/exam-published/student-1',
    );
  });

  it('marks a failed exam with a badge', async () => {
    server.use(
      http.get('/api/v1/students/:studentId/results', () =>
        HttpResponse.json([
          {
            exam_id: 'exam-fail',
            exam_name: 'Half Yearly',
            exam_kind: 'TERM',
            published: true,
            total_marks: 100,
            gpa: 0,
            grade: 'F',
            position: 30,
            is_fail: true,
          },
        ]),
      ),
    );

    renderPanel();

    await screen.findByText('Half Yearly');
    expect(screen.getByText('0.00')).toBeTruthy();
  });

  it('renders the empty state for a student with no results', async () => {
    server.use(http.get('/api/v1/students/:studentId/results', () => HttpResponse.json([])));

    renderPanel();

    expect(await screen.findByText('No results yet for this student.')).toBeTruthy();
  });
});

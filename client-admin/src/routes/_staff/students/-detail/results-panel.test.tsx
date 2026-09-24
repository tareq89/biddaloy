import { cleanupTestState, renderWithProviders, server } from '@biddaloy/ui/test';
import { screen } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { afterEach, describe, expect, it } from 'vitest';

import { ResultsPanel } from './results-panel';

/** [19.9.1] Staff results panel — every exam, unpublished ones labelled so
 * staff never mistake an unpublished grade for one a parent can see. */
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

    renderWithProviders(<ResultsPanel studentId="student-1" />, {
      locale: 'en',
      role: 'ADMIN',
      tenantId: 'tenant-1',
    });

    expect(await screen.findByText('First Term Exam')).toBeTruthy();
    expect(screen.getByText('Monthly Test')).toBeTruthy();
    expect(screen.getByText('Not yet published')).toBeTruthy();
    expect(screen.getByText('Published')).toBeTruthy();
  });

  it('renders the empty state for a student with no results', async () => {
    server.use(http.get('/api/v1/students/:studentId/results', () => HttpResponse.json([])));

    renderWithProviders(<ResultsPanel studentId="student-1" />, {
      locale: 'en',
      role: 'ADMIN',
      tenantId: 'tenant-1',
    });

    expect(await screen.findByText('No results yet for this student.')).toBeTruthy();
  });
});

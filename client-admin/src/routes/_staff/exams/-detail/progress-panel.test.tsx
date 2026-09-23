import { cleanupTestState, examFactory, renderWithRouter, server } from '@biddaloy/ui/test';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { afterEach, describe, expect, it } from 'vitest';

import { routeTree } from '../../../../routeTree.gen';

/** [19.6.1] Progress tab — counts, the outstanding filter, and each row's
 * link carrying exam + section + subject into the (not-yet-built, #903)
 * marks grid. */
describe('exams/$examId Progress tab', () => {
  afterEach(async () => {
    await cleanupTestState();
  });

  it('shows the submitted-of-total count and a filterable outstanding list whose rows link into the grid', async () => {
    const user = userEvent.setup();
    const exam = examFactory({ id: 'exam-1', name: 'Half Yearly 2026' });
    server.use(
      http.get('/api/v1/exams/:id', () => HttpResponse.json(exam)),
      http.get('/api/v1/exams/:examId/marks/progress', () =>
        HttpResponse.json({
          counts: { DRAFT: 1, SUBMITTED: 1 },
          outstanding: [
            {
              section_id: 'section-a',
              section_name: 'Section A',
              subject_id: 'subject-math',
              state: 'DRAFT',
            },
            {
              section_id: 'section-b',
              section_name: 'Section B',
              subject_id: 'subject-eng',
              state: 'SUBMITTED',
            },
          ],
        }),
      ),
    );

    renderWithRouter(routeTree, {
      initialEntries: ['/exams/exam-1?tab=progress'],
      tenantId: 'tenant-1',
      role: 'ADMIN',
      locale: 'en',
    });

    await screen.findByText('1 of 2 grids submitted');
    const sectionARow = await screen.findByRole('link', { name: 'Section A' });
    expect(sectionARow.getAttribute('href')).toBe(
      '/exams/exam-1/marks?section=section-a&subject=subject-math',
    );
    expect(screen.getByRole('link', { name: 'Section B' })).toBeTruthy();

    // Filter to Draft only — Section B (SUBMITTED) drops out of the list.
    await user.click(screen.getByLabelText('Filter by state'));
    await user.click(await screen.findByRole('option', { name: 'Draft' }));

    await waitFor(() => expect(screen.queryByRole('link', { name: 'Section B' })).toBeNull());
    expect(screen.getByRole('link', { name: 'Section A' })).toBeTruthy();
  });
});

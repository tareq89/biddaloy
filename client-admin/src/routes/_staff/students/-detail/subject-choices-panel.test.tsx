import {
  academicYearFactory,
  cleanupTestState,
  renderWithProviders,
  server,
  subjectFactory,
} from '@biddaloy/ui/test';
import { screen, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { afterEach, describe, expect, it } from 'vitest';

import { SubjectChoicesPanel } from './subject-choices-panel';

/** [19.6.1] Fourth-subject panel — selecting a new fourth replaces
 * whichever one was previously chosen (the PUT is idempotent, #899/#900). */
describe('SubjectChoicesPanel', () => {
  afterEach(async () => {
    await cleanupTestState();
  });

  it('replaces the previous fourth-subject choice on reselect', async () => {
    const year = academicYearFactory({ id: 'year-1', is_current: true });
    const history = subjectFactory({ id: 'subject-history', name_en: 'History' });
    const geography = subjectFactory({ id: 'subject-geo', name_en: 'Geography' });
    let currentFourth = 'class-subject-history';

    server.use(
      http.get('/api/v1/academic-years', () =>
        HttpResponse.json({ data: [year], total: 1, page: 1, limit: 100, totalPages: 1 }),
      ),
      http.get('/api/v1/subjects', () =>
        HttpResponse.json({
          data: [history, geography],
          total: 2,
          page: 1,
          limit: 100,
          totalPages: 1,
        }),
      ),
      http.get('/api/v1/students/:studentId/subject-choices', () =>
        HttpResponse.json([
          {
            class_subject_id: 'class-subject-history',
            subject_id: history.id,
            chosen: currentFourth === 'class-subject-history',
            is_fourth: currentFourth === 'class-subject-history',
          },
          {
            class_subject_id: 'class-subject-geo',
            subject_id: geography.id,
            chosen: currentFourth === 'class-subject-geo',
            is_fourth: currentFourth === 'class-subject-geo',
          },
        ]),
      ),
      http.put('/api/v1/students/:studentId/subject-choices', async ({ request }) => {
        const body = (await request.json()) as { class_subject_id: string };
        currentFourth = body.class_subject_id;
        return HttpResponse.json({});
      }),
    );

    const { user } = renderWithProviders(<SubjectChoicesPanel studentId="student-1" />, {
      locale: 'en',
      role: 'ADMIN',
      tenantId: 'tenant-1',
    });

    const historyRadio = await screen.findByRole('radio', { name: 'History' });
    expect(historyRadio.getAttribute('aria-checked')).toBe('true');

    await user.click(screen.getByRole('radio', { name: 'Geography' }));

    await waitFor(() => expect(currentFourth).toBe('class-subject-geo'));
  });
});

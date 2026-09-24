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

  const year = academicYearFactory({ id: 'year-1', is_current: true });
  const history = subjectFactory({ id: 'subject-history', name_en: 'History' });
  const yearsOk = () =>
    HttpResponse.json({ data: [year], total: 1, page: 1, limit: 100, totalPages: 1 });
  const subjectsOk = () =>
    HttpResponse.json({ data: [history], total: 1, page: 1, limit: 100, totalPages: 1 });
  const optionsOk = () =>
    HttpResponse.json([
      {
        class_subject_id: 'class-subject-history',
        subject_id: history.id,
        chosen: false,
        is_fourth: false,
      },
    ]);
  const fail = () => HttpResponse.json({ message: 'boom' }, { status: 500 });

  function renderPanel() {
    return renderWithProviders(<SubjectChoicesPanel studentId="student-1" />, {
      locale: 'en',
      role: 'ADMIN',
      tenantId: 'tenant-1',
    });
  }

  it('shows error + retry when the academic-year lookup fails, and recovers on retry', async () => {
    let yearsFail = true;
    server.use(
      http.get('/api/v1/academic-years', () => (yearsFail ? fail() : yearsOk())),
      http.get('/api/v1/subjects', subjectsOk),
      http.get('/api/v1/students/:studentId/subject-choices', optionsOk),
    );
    const { user } = renderPanel();

    // Not the "no options" empty state — optionsQuery never ran.
    await screen.findByText("Couldn't load subject choices.", {}, { timeout: 5000 });
    expect(screen.queryByText(/No optional subjects/)).toBeNull();

    yearsFail = false;
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    await screen.findByRole('radio', { name: 'History' });
  });

  it('shows error + retry instead of raw subject IDs when the subjects lookup fails', async () => {
    server.use(
      http.get('/api/v1/academic-years', yearsOk),
      http.get('/api/v1/subjects', fail),
      http.get('/api/v1/students/:studentId/subject-choices', optionsOk),
    );
    renderPanel();

    await screen.findByText("Couldn't load subject choices.", {}, { timeout: 5000 });
    expect(screen.queryByText(history.id)).toBeNull();
  });

  it('shows error + retry when the options lookup fails', async () => {
    server.use(
      http.get('/api/v1/academic-years', yearsOk),
      http.get('/api/v1/subjects', subjectsOk),
      http.get('/api/v1/students/:studentId/subject-choices', fail),
    );
    renderPanel();

    await screen.findByText("Couldn't load subject choices.", {}, { timeout: 5000 });
  });

  it('shows the empty state when no optional subjects are offered', async () => {
    server.use(
      http.get('/api/v1/academic-years', yearsOk),
      http.get('/api/v1/subjects', subjectsOk),
      http.get('/api/v1/students/:studentId/subject-choices', () => HttpResponse.json([])),
    );
    renderPanel();

    await screen.findByText("No optional subjects are offered for this student's class.");
  });

  it('surfaces a failed save', async () => {
    server.use(
      http.get('/api/v1/academic-years', yearsOk),
      http.get('/api/v1/subjects', subjectsOk),
      http.get('/api/v1/students/:studentId/subject-choices', optionsOk),
      http.put('/api/v1/students/:studentId/subject-choices', () =>
        HttpResponse.json({ message: 'nope' }, { status: 409 }),
      ),
    );
    const { user } = renderPanel();

    await user.click(await screen.findByRole('radio', { name: 'History' }));
    await screen.findByRole('alert');
  });
});

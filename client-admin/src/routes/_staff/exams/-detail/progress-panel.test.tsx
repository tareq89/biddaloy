import { cleanupTestState, examFactory, renderWithRouter, server } from '@biddaloy/ui/test';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { afterEach, describe, expect, it } from 'vitest';

import { routeTree } from '../../../../routeTree.gen';

import { subjectLabel } from './subject-label';

/** [19.6.1] / [31.4.exams-2a] Progress tab — summary, outstanding list with
 * subject + section, and each row's pencil linking into the marks grid. */
describe('exams/$examId Progress tab', () => {
  afterEach(async () => {
    await cleanupTestState();
  });

  function mockProgress(progress: Record<string, unknown>) {
    server.use(
      http.get('/api/v1/exams/:id', () =>
        HttpResponse.json(examFactory({ id: 'exam-1', name: 'Half Yearly 2026' })),
      ),
      http.get('/api/v1/exams/:examId/marks/progress', () => HttpResponse.json(progress)),
    );
    return renderWithRouter(routeTree, {
      initialEntries: ['/exams/exam-1?tab=progress'],
      tenantId: 'tenant-1',
      role: 'ADMIN',
      locale: 'en',
    });
  }

  const row = (section: string, subject: string, id: string) => ({
    section_id: `section-${section}`,
    section_name: section,
    subject_id: id,
    subject_name: subject,
    subject_name_bn: null,
    state: 'DRAFT',
  });

  it('shows the summary and a subject + section list whose pencil links into the grid', async () => {
    mockProgress({
      counts: { DRAFT: 1, SUBMITTED: 1 },
      outstanding: [row('A', 'Mathematics', 'subject-math'), row('B', 'English', 'subject-eng')],
    });

    await screen.findByText('1 of 2 marks lists submitted');
    const bar = screen.getByRole('progressbar', { name: 'Marks submission progress' });
    expect(bar.getAttribute('aria-valuenow')).toBe('1');
    expect(bar.getAttribute('aria-valuemax')).toBe('2');

    const mathRow = (await screen.findByText('Mathematics')).closest('tr') as HTMLElement;
    expect(within(mathRow).getByText('Section A')).toBeTruthy();
    expect(
      within(mathRow).getByRole('link', { name: 'Enter marks' }).getAttribute('href'),
    ).toBe('/marks/exam-1/section-A/subject-math');
    expect(screen.getByText('English')).toBeTruthy();
    // The server only returns unsubmitted lists, so there is no state filter.
    expect(screen.queryByLabelText('Filter by state')).toBeNull();
  });

  it('pages 30 outstanding lists at 25 and shows the total', async () => {
    mockProgress({
      counts: { DRAFT: 30, SUBMITTED: 0 },
      outstanding: Array.from({ length: 30 }, (_, i) =>
        row(`S${String(i).padStart(2, '0')}`, 'Mathematics', `subject-${i}`),
      ),
    });

    await screen.findByText('0 of 30 marks lists submitted');
    await screen.findAllByRole('link', { name: 'Enter marks' });
    const table = screen.getByRole('table');
    expect(within(table).getAllByRole('link', { name: 'Enter marks' })).toHaveLength(25);
  });

  it('shows the all-submitted empty state', async () => {
    mockProgress({ counts: { DRAFT: 0, SUBMITTED: 4 }, outstanding: [] });
    await screen.findByText('Every marks list is submitted');
  });

  it('shows the no-lists empty state whose button switches to the Marks breakdown tab', async () => {
    const view = mockProgress({ counts: { DRAFT: 0, SUBMITTED: 0 }, outstanding: [] });
    await screen.findByText('No marks lists yet');
    await userEvent.setup().click(screen.getByRole('button', { name: 'Go to Marks breakdown' }));
    expect(view.router.state.location.search).toMatchObject({ tab: 'setup' });
  });

  it('subjectLabel prefers the Bangla name on Bangla screens', () => {
    const subject = { name_en: 'Mathematics', name_bn: 'গণিত' };
    expect(subjectLabel(subject, 'bn')).toBe('গণিত');
    expect(subjectLabel(subject, 'en')).toBe('Mathematics');
    expect(subjectLabel({ name_en: 'Mathematics', name_bn: null }, 'bn')).toBe('Mathematics');
  });
});

import { REGION_BD_BN } from '@biddaloy/ui/i18n';
import { cleanupTestState, examFactory, renderWithRouter, server } from '@biddaloy/ui/test';
import { formatNumber } from '@biddaloy/ui/utils';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { afterEach, describe, expect, it } from 'vitest';

import { routeTree } from '../../../routeTree.gen';

type State = 'DRAFT' | 'SUBMITTED';

const row = (section: string, subject: string, id: string, state: State) => ({
  section_id: `sec-${id}`,
  section_name: section,
  subject_id: `subj-${id}`,
  subject_name: subject,
  subject_name_bn: null,
  state,
});

function mockExam(
  outstanding: ReturnType<typeof row>[],
  exam = examFactory({ id: 'exam-1', name: 'Half Yearly 2026' }),
) {
  const counts = {
    DRAFT: outstanding.filter((r) => r.state === 'DRAFT').length,
    SUBMITTED: outstanding.filter((r) => r.state === 'SUBMITTED').length,
  };
  server.use(
    http.get('/api/v1/exams', () =>
      HttpResponse.json({ data: [exam], total: 1, page: 1, limit: 50, totalPages: 1 }),
    ),
    http.get(`/api/v1/exams/${exam.id}/marks/progress`, () =>
      HttpResponse.json({ counts, outstanding }),
    ),
  );
  return exam;
}

// The sidebar also has an "Enter marks" link; the rows' links point into an exam.
const rowLinks = (name: string) =>
  screen
    .queryAllByRole('link', { name })
    .filter((a) => a.getAttribute('href')?.startsWith('/marks/exam-1'));
const findRowLinks = (name: string) =>
  waitFor(() => {
    const links = rowLinks(name);
    expect(links.length).toBeGreaterThan(0);
    return links;
  });

const render = (role: string) =>
  renderWithRouter(routeTree, {
    initialEntries: ['/marks'],
    tenantId: 'tenant-1',
    role,
    locale: 'en',
  });

describe('/marks', () => {
  afterEach(async () => {
    await cleanupTestState();
  });

  it('lists a draft with "Enter marks" linking into the entry page, and a submitted one with "View marks"', async () => {
    mockExam([row('Six - B', 'Math', '2', 'SUBMITTED'), row('Six - A', 'Math', '1', 'DRAFT')]);
    render('TEACHER');

    await screen.findByRole('heading', { name: 'Enter marks' });
    const [enter] = await findRowLinks('Enter marks');
    expect(enter!.getAttribute('href')).toBe('/marks/exam-1/sec-1/subj-1');
    const [view] = rowLinks('View marks');
    expect(view!.getAttribute('href')).toBe('/marks/exam-1/sec-2/subj-2');
    // Both status badges are visible.
    expect(screen.getAllByText('Submitted').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Not submitted').length).toBeGreaterThan(0);
  });

  it('labels the exam picker, names the class, and shows progress in the subtitle', async () => {
    const exam = mockExam([
      row('Six - A', 'Math', '1', 'DRAFT'),
      row('Six - B', 'Math', '2', 'SUBMITTED'),
    ]);
    render('TEACHER');

    const picker = await screen.findByLabelText('Exam');
    expect(picker.textContent).toContain(`${exam.name} · ${exam.class?.name}`);
    await screen.findByText(
      `${formatNumber(1, REGION_BD_BN)} of ${formatNumber(2, REGION_BD_BN)} marks lists submitted`,
    );
  });

  it('shows drafts above submitted rows and a total in the footer', async () => {
    mockExam([row('Six - B', 'Math', '2', 'SUBMITTED'), row('Six - A', 'Math', '1', 'DRAFT')]);
    render('TEACHER');

    await findRowLinks('Enter marks');
    // Draft (sec-1) before submitted (sec-2), whatever order the server sent.
    const hrefs = screen
      .getAllByRole('link')
      .map((a) => a.getAttribute('href'))
      .filter((h) => h?.startsWith('/marks/exam-1'));
    expect(hrefs).toEqual(['/marks/exam-1/sec-1/subj-1', '/marks/exam-1/sec-2/subj-2']);
    expect(screen.getByText('Total 2')).toBeTruthy();
  });

  it('the status filter hides the other group', async () => {
    const user = userEvent.setup();
    mockExam([row('Six - B', 'Math', '2', 'SUBMITTED'), row('Six - A', 'Math', '1', 'DRAFT')]);
    render('TEACHER');

    await findRowLinks('Enter marks');
    await user.click(screen.getByRole('combobox', { name: 'Status' }));
    await user.click(await screen.findByRole('option', { name: 'Not submitted' }));
    await screen.findByText('Total 1');
    expect(rowLinks('View marks')).toHaveLength(0);
  });

  it('renders the search field only with EXAM_MANAGE', async () => {
    mockExam([row('Six - A', 'Math', '1', 'DRAFT')]);
    const first = render('TEACHER');
    await findRowLinks('Enter marks');
    expect(screen.queryByLabelText('Search')).toBeNull();
    first.unmount();

    mockExam([row('Six - A', 'Math', '1', 'DRAFT')]);
    render('ADMIN');
    await screen.findByLabelText('Search');
  });

  it('shows the empty state and no footer when there are no marks lists', async () => {
    mockExam([]);
    render('TEACHER');

    await screen.findByText('No marks lists yet');
    expect(screen.queryByText(/^Total/)).toBeNull();
  });

  it('shows "No exams yet" and no picker when there are no exams', async () => {
    server.use(
      http.get('/api/v1/exams', () =>
        HttpResponse.json({ data: [], total: 0, page: 1, limit: 50, totalPages: 0 }),
      ),
    );
    render('TEACHER');

    await screen.findByText('No exams yet');
    expect(screen.queryByLabelText('Exam')).toBeNull();
  });

  it('shows the load error line when the progress request fails', async () => {
    const exam = examFactory({ id: 'exam-1', name: 'Half Yearly 2026' });
    server.use(
      http.get('/api/v1/exams', () =>
        HttpResponse.json({ data: [exam], total: 1, page: 1, limit: 50, totalPages: 1 }),
      ),
      http.get('/api/v1/exams/exam-1/marks/progress', () =>
        HttpResponse.json({ message: 'boom' }, { status: 400 }),
      ),
    );
    render('TEACHER');

    await screen.findByText("Couldn't load marks lists.");
  });
});

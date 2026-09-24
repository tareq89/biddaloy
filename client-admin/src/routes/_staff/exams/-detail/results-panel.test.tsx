import { cleanupTestState, examFactory, renderWithRouter, server } from '@biddaloy/ui/test';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { afterEach, describe, expect, it } from 'vitest';

import { routeTree } from '../../../../routeTree.gen';

/** [19.8.1] Results tab — sorting, the fail filter, and rendering a tied
 * position without crashing (two students may legitimately share a rank). */
describe('exams/$examId Results tab', () => {
  afterEach(async () => {
    await cleanupTestState();
  });

  const ROWS = [
    {
      student_id: 'stu-1',
      roll_number: 3,
      full_name: 'Zahid Islam',
      total_marks: 300,
      gpa: 3.5,
      grade: 'B',
      position: 2,
      is_fail: false,
    },
    {
      student_id: 'stu-2',
      roll_number: 1,
      full_name: 'Amina Khatun',
      total_marks: 450,
      gpa: 5,
      grade: 'A+',
      position: 1,
      is_fail: false,
    },
    {
      student_id: 'stu-3',
      roll_number: 2,
      full_name: 'Karim Rahman',
      total_marks: 100,
      gpa: 0,
      grade: 'F',
      position: 2,
      is_fail: true,
    },
  ];

  function mockExam(status: 'DRAFT' | 'PROCESSED' | 'PUBLISHED' = 'PROCESSED') {
    return examFactory({ id: 'exam-1', name: 'Half Yearly 2026', status });
  }

  it('renders rows sorted by position (ties allowed) and toggles the fail filter', async () => {
    server.use(
      http.get('/api/v1/exams/:id', () => HttpResponse.json(mockExam())),
      http.get('/api/v1/exams/:examId/results', () => HttpResponse.json(ROWS)),
    );

    renderWithRouter(routeTree, {
      initialEntries: ['/exams/exam-1?tab=results'],
      tenantId: 'tenant-1',
      role: 'ADMIN',
      locale: 'en',
    });

    const links = await screen.findAllByRole('link', {
      name: /Amina Khatun|Zahid Islam|Karim Rahman/,
    });
    // Position-ordered: Amina (1) first, then Zahid/Karim tied at 2 — both
    // present, order between ties is whatever the server returned.
    expect(links[0]?.textContent).toContain('Amina Khatun');
    expect(links.length).toBe(3);

    const user = userEvent.setup();
    await user.click(screen.getByLabelText('Fails only'));

    await waitFor(() => expect(screen.queryByRole('link', { name: /Amina Khatun/ })).toBeNull());
    expect(screen.getByRole('link', { name: /Karim Rahman/ })).toBeTruthy();
  });

  it('re-sorts by a column when its header is clicked', async () => {
    server.use(
      http.get('/api/v1/exams/:id', () => HttpResponse.json(mockExam())),
      http.get('/api/v1/exams/:examId/results', () => HttpResponse.json(ROWS)),
    );

    renderWithRouter(routeTree, {
      initialEntries: ['/exams/exam-1?tab=results'],
      tenantId: 'tenant-1',
      role: 'ADMIN',
      locale: 'en',
    });

    await screen.findByRole('link', { name: /Amina Khatun/ });
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Total' }));

    const rows = screen.getAllByRole('link', { name: /Khatun|Islam|Rahman/ });
    // Ascending total_marks: Karim (100) first.
    expect(rows[0]?.textContent).toContain('Karim Rahman');
  });

  it('shows the empty state before an exam is processed', async () => {
    server.use(
      http.get('/api/v1/exams/:id', () => HttpResponse.json(mockExam('DRAFT'))),
      http.get('/api/v1/exams/:examId/results', () => HttpResponse.json([])),
    );

    renderWithRouter(routeTree, {
      initialEntries: ['/exams/exam-1?tab=results'],
      tenantId: 'tenant-1',
      role: 'ADMIN',
      locale: 'en',
    });

    await screen.findByText('No results yet — process this exam first.');
  });
});

import '@biddaloy/ui/test';

import { RegionConfigProvider } from '@biddaloy/ui/i18n';
import {
  cleanupTestState,
  renderWithProviders,
  renderWithRouter,
  server,
  studentFactory,
} from '@biddaloy/ui/test';
import { fireEvent, screen } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { routeTree } from '../../../../routeTree.gen';

import { PerformanceTab } from './performance-tab';

const STUDENT_ID = 'student-1';

const homework = { totalAssignments: 10, completed: 8, defaulters: 2, completionPercent: 80 };
const base = {
  studentId: STUDENT_ID,
  classId: 'class-1',
  sectionId: null,
  academicYearId: 'year-1',
  termId: null,
  from: '2026-01-01',
  to: '2026-12-31',
  passRate: 90,
  averageMarks: 72.5,
  averageGpa: 3.5,
  attendancePercent: 95,
  homework,
  noteRatingAverage: 4,
  noteRatingCount: 2,
  exams: [
    { examId: 'e1', examName: 'Midterm', totalMarks: 410, gpa: 4, grade: 'A', isFail: false },
  ],
};

function years() {
  server.use(
    http.get('/api/v1/academic-years', () =>
      HttpResponse.json({
        data: [{ id: 'year-1', name: '2026', is_current: true }],
        total: 1,
        page: 1,
        limit: 100,
      }),
    ),
  );
}

function renderTab() {
  return renderWithProviders(
    <RegionConfigProvider>
      <PerformanceTab studentId={STUDENT_ID} subjectName="Rina Akter" />
    </RegionConfigProvider>,
    { locale: 'en', role: 'TEACHER', tenantId: 'tenant-1' },
  );
}

describe('student PerformanceTab', () => {
  afterEach(async () => {
    await cleanupTestState();
  });

  it('renders the summary and widgets with data', async () => {
    years();
    server.use(http.get('/api/v1/performance/students/:id', () => HttpResponse.json(base)));
    renderTab();

    expect(await screen.findByText('Pass rate')).toBeTruthy();
    expect(
      document.querySelector('#performance-print-area h2.performance-print-title')?.textContent,
    ).toBe('Performance report — Rina Akter');
    expect(screen.getByText('90%')).toBeTruthy();
    expect(screen.getByText('Midterm (A)')).toBeTruthy();
    expect(screen.getByText('4 / 5')).toBeTruthy();
  });

  it('prints the on-screen content via window.print', async () => {
    years();
    server.use(http.get('/api/v1/performance/students/:id', () => HttpResponse.json(base)));
    renderTab();
    expect(screen.queryByRole('button', { name: 'Print / Save as PDF' })).toBeNull();
    await screen.findByText('Pass rate');
    const print = vi.spyOn(window, 'print').mockImplementation(() => undefined);
    const button = screen.getByRole('button', { name: 'Print / Save as PDF' });
    expect(button.parentElement?.className).toContain('print:hidden');
    expect(button.closest('#performance-print-area')).not.toBeNull();
    fireEvent.click(button);
    expect(print).toHaveBeenCalledTimes(1);
    print.mockRestore();
  });

  it('shows "Not enough data yet" per widget when there is nothing', async () => {
    years();
    server.use(
      http.get('/api/v1/performance/students/:id', () =>
        HttpResponse.json({
          ...base,
          passRate: null,
          averageMarks: null,
          averageGpa: null,
          attendancePercent: null,
          homework: { ...homework, totalAssignments: 0 },
          noteRatingAverage: null,
          noteRatingCount: 0,
          exams: [],
        }),
      ),
    );
    renderTab();

    // summary card + 4 widgets
    expect((await screen.findAllByText('Not enough data yet')).length).toBe(5);
  });

  it('treats a 404 (no current-year enrollment) as the empty state, not an error', async () => {
    years();
    server.use(
      http.get('/api/v1/performance/students/:id', () =>
        HttpResponse.json(
          {
            statusCode: 404,
            message: 'Student has no enrollment',
            timestamp: '2026-01-01T00:00:00Z',
            path: '/',
            requestId: 'r1',
          },
          { status: 404 },
        ),
      ),
    );
    renderTab();

    expect((await screen.findAllByText('Not enough data yet')).length).toBe(5);
    expect(screen.queryByText("Couldn't load performance.")).toBeNull();
  });

  it('shows an error state with retry when the request fails', async () => {
    years();
    server.use(
      http.get('/api/v1/performance/students/:id', () =>
        HttpResponse.json({ message: 'boom' }, { status: 500 }),
      ),
    );
    renderTab();

    expect(
      await screen.findByText("Couldn't load performance.", {}, { timeout: 4000 }),
    ).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Retry' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Print / Save as PDF' })).toBeNull();
  });
});

describe('student detail Performance tab visibility', () => {
  afterEach(async () => {
    await cleanupTestState();
  });

  it.each([
    ['TEACHER', true],
    ['ACCOUNTANT', false],
  ])('%s sees the tab: %s', async (role, visible) => {
    const student = studentFactory({ id: STUDENT_ID });
    server.use(http.get('/api/v1/students/:id', () => HttpResponse.json(student)));
    renderWithRouter(routeTree, {
      initialEntries: [`/students/${STUDENT_ID}`],
      tenantId: 'tenant-1',
      role: role,
      locale: 'en',
    });

    await screen.findByRole('heading', { name: student.full_name });
    const tab = screen.queryByRole('tab', { name: 'Performance' });
    expect(tab !== null).toBe(visible);
  });
});

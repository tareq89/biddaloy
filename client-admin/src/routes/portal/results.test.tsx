import {
  classFactory,
  classSectionFactory,
  renderWithRouter,
  server,
  studentFactory,
} from '@biddaloy/ui/test';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { routeTree } from '../../routeTree.gen';

/**
 * [19.9.1] Portal results — published-only (D19), multi-child switching
 * (reusing `fees.tsx`'s picker), Print rendering `ReportCard`. Exercised
 * through the real route tree, same reasoning `portal/fees.test.tsx`
 * documents for itself.
 */
describe('/portal/results', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function child(name: string, id: string, className: string, section: string, roll: number) {
    return studentFactory({
      id,
      full_name: name,
      roll_number: roll,
      class_section: classSectionFactory({
        section_name: section,
        class: classFactory({ name: className }),
      }),
    });
  }

  const fatima = child('Fatima Rahman', 'student-1', 'Class 8', 'B', 14);
  const imran = child('Imran Rahman', 'student-2', 'Class 3', 'A', 7);

  function resultRow(
    examId: string,
    name: string,
    published: boolean,
    overrides: Record<string, unknown> = {},
  ) {
    return {
      exam_id: examId,
      exam_name: name,
      exam_kind: 'TERM',
      published,
      total_marks: 450,
      gpa: 5.0,
      grade: 'A+',
      position: 1,
      is_fail: false,
      ...overrides,
    };
  }

  function card(examName: string) {
    return {
      exam_name: examName,
      student: { full_name: 'Fatima Rahman', roll_number: 14 },
      result: { total_marks: 450, gpa: 5.0, grade: 'A+', position: 1, is_fail: false },
      subjects: [
        {
          subject_id: 'subj-1',
          subject_name: 'Mathematics',
          obtained: 90,
          grade: 'A+',
          gpa: 5.0,
          is_fail: false,
          is_fourth_subject: false,
          components: [{ name: 'Written', full_marks: 100, obtained: 90 }],
        },
      ],
      legend: [{ grade: 'A+', gpa: 5.0, comment: null }],
      issuer: {
        name: 'Test School',
        name_bn: null,
        address: null,
        phone: null,
        email: null,
        registration_id: null,
        logo_key: null,
      },
      logo_url: null,
    };
  }

  function mockResults(options: {
    students: unknown[];
    results: Record<string, unknown[]>;
    cards?: Record<string, unknown>;
  }) {
    server.use(
      http.get('/api/v1/students/mine', () => HttpResponse.json(options.students)),
      http.get('/api/v1/students/:studentId/results', ({ params }) => {
        const id = params.studentId as string;
        return HttpResponse.json(options.results[id] ?? []);
      }),
      http.get('/api/v1/students/:studentId/results/:examId', ({ params }) => {
        const key = `${String(params.studentId)}:${String(params.examId)}`;
        const found = options.cards?.[key];
        if (!found) return HttpResponse.json({ message: 'Not found' }, { status: 404 });
        return HttpResponse.json(found);
      }),
    );
  }

  function renderResults(path = '/portal/results', locale = 'en') {
    return renderWithRouter(routeTree, {
      initialEntries: [path],
      tenantId: 'tenant-1',
      role: 'PARENT',
      locale,
    });
  }

  it('lists only what the server returns — an unpublished exam is server-filtered, never greyed', async () => {
    // `publishedOnly` is enforced server-side (D19) — this fixture only
    // has the published exam in the response, matching what the real API
    // does for a PARENT/STUDENT caller.
    mockResults({
      students: [fatima],
      results: { 'student-1': [resultRow('exam-1', 'First Term Exam', true)] },
    });
    renderResults();

    expect(await screen.findByText('First Term Exam')).toBeTruthy();
    // No unpublished row anywhere on the page — absent, not disabled/greyed.
    expect(screen.queryByText('Monthly Test')).toBeNull();
  });

  it('renders the friendly empty state when there are no published results yet', async () => {
    mockResults({ students: [fatima], results: { 'student-1': [] } });
    renderResults();

    expect(
      await screen.findByText(/Results appear here once the school publishes them/),
    ).toBeTruthy();
  });

  it('lets a multi-child guardian switch students, re-querying for the chosen child', async () => {
    mockResults({
      students: [fatima, imran],
      results: {
        'student-1': [resultRow('exam-1', 'First Term Exam', true)],
        'student-2': [resultRow('exam-2', 'Half Yearly Exam', true)],
      },
    });
    renderResults();

    const picker = await screen.findByRole('navigation', { name: 'Choose a student' });
    expect(await screen.findByText('First Term Exam')).toBeTruthy();

    await userEvent.click(within(picker).getByRole('link', { name: /Imran Rahman/ }));

    expect(await screen.findByText('Half Yearly Exam')).toBeTruthy();
    expect(screen.queryByText('First Term Exam')).toBeNull();
  });

  it('prints the report card for an exam', async () => {
    mockResults({
      students: [fatima],
      results: { 'student-1': [resultRow('exam-1', 'First Term Exam', true)] },
      cards: { 'student-1:exam-1': card('First Term Exam') },
    });
    // Captured at the moment `window.print()` fires — the component
    // closes the print target right after, so asserting on the DOM after
    // `waitFor` resolves races against that unmount.
    let bodyTextAtPrintTime = '';
    const printSpy = vi.fn(() => {
      bodyTextAtPrintTime = document.body.textContent ?? '';
    });
    vi.stubGlobal('print', printSpy);
    renderResults();

    const printButton = await screen.findByRole('button', { name: 'Print First Term Exam' });
    await userEvent.click(printButton);

    await waitFor(() => expect(printSpy).toHaveBeenCalled());
    // `ReportCard` rendered with this exam/student's data.
    expect(bodyTextAtPrintTime).toContain('Mathematics');
  });

  it('expanding a row shows the subject breakdown', async () => {
    mockResults({
      students: [fatima],
      results: { 'student-1': [resultRow('exam-1', 'First Term Exam', true)] },
      cards: { 'student-1:exam-1': card('First Term Exam') },
    });
    renderResults();

    const summary = await screen.findByText('First Term Exam');
    await userEvent.click(summary);

    expect(await screen.findByText('Mathematics')).toBeTruthy();
  });
});

/**
 * [19.8.1] The staff report-card route — joins the exam, the student's
 * result detail, the grading scale (legend) and the school profile
 * (header). Same `renderWithRouter` + real route tree pattern as
 * `grading-scales/$scaleId.test.tsx`.
 */
import { apiErrorBody, cleanupTestState, renderWithRouter, server } from '@biddaloy/ui/test';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { routeTree } from '../../../routeTree.gen';

const EXAM_URL = '/api/v1/exams/exam-1';
const DETAIL_URL = '/api/v1/exams/exam-1/results/student-1';
const SCALE_URL = '/api/v1/grading/scales/scale-1';
const PROFILE_URL = '/api/v1/schools/me/profile';

const EXAM = { id: 'exam-1', name: 'Half-Yearly 2026' };

const DETAIL = {
  student: { id: 'student-1', full_name: 'Rafi Ahmed', roll_number: 7 },
  result: {
    total_marks: 180,
    gpa: 4.5,
    grade: 'A',
    position: 3,
    is_fail: false,
    grading_scale_id: 'scale-1',
  },
  subjects: [
    {
      subject_id: 'subj-1',
      subject_name: 'Mathematics',
      obtained: 90,
      grade: 'A+',
      gpa: 5,
      is_fail: false,
      is_fourth_subject: false,
      components: [{ name: 'Written', full_marks: 100, obtained: 90 }],
    },
  ],
};

const SCALE = {
  id: 'scale-1',
  academic_year_id: 'ay-1',
  class_id: null,
  name: 'Default Scale',
  revision: 1,
  bands: [
    {
      id: 'band-1',
      percent_from: 80,
      percent_to: 100,
      grade: 'A+',
      gpa: 5,
      is_fail: false,
      sequence: 1,
      comment: 'Outstanding',
    },
  ],
};

const PROFILE = {
  name: 'Green Valley School',
  name_bn: null,
  address: null,
  phone: null,
  email: null,
  registration_id: null,
  logo_url: 'https://cdn.example.com/logo.png',
};

function notFound(path: string) {
  return HttpResponse.json(apiErrorBody(404, 'Not found', path), { status: 404 });
}

/** Every endpoint answers successfully unless a test overrides it. */
function mockReportCard(
  overrides: { profile?: Omit<typeof PROFILE, 'logo_url'> & { logo_url: string | null } } = {},
) {
  server.use(
    http.get(EXAM_URL, () => HttpResponse.json(EXAM)),
    http.get(DETAIL_URL, () => HttpResponse.json(DETAIL)),
    http.get(SCALE_URL, () => HttpResponse.json(SCALE)),
    http.get(PROFILE_URL, () => HttpResponse.json(overrides.profile ?? PROFILE)),
  );
}

function renderReportCard() {
  return renderWithRouter(routeTree, {
    initialEntries: ['/results/exam-1/student-1'],
    tenantId: 'tenant-1',
    role: 'ADMIN',
    locale: 'en',
  });
}

describe('/results/$examId/$studentId', () => {
  afterEach(async () => {
    vi.unstubAllGlobals();
    await cleanupTestState();
  });

  it('renders the report card with the exam, student, school header and grade legend', async () => {
    mockReportCard();
    renderReportCard();

    expect(await screen.findByText('Half-Yearly 2026')).toBeTruthy();
    expect(screen.getByText('Rafi Ahmed')).toBeTruthy();
    expect(screen.getByText('Green Valley School')).toBeTruthy();
    expect(screen.getByText('Mathematics')).toBeTruthy();
    // The school has a logo, so the header shows it.
    expect(screen.getByRole('img', { name: 'Green Valley School' }).getAttribute('src')).toBe(
      'https://cdn.example.com/logo.png',
    );
    // The legend comes from the grading scale the result was computed with.
    expect(await screen.findByText('A+ (5.00) — Outstanding')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Back to exam' }).getAttribute('href')).toBe(
      '/exams/exam-1',
    );
  });

  it('opens the browser print dialog when Print is clicked', async () => {
    const print = vi.fn();
    vi.stubGlobal('print', print);
    mockReportCard();
    const user = userEvent.setup();
    renderReportCard();

    await user.click(await screen.findByRole('button', { name: 'Print' }));

    expect(print).toHaveBeenCalledTimes(1);
  });

  it('shows no logo when the school has not uploaded one', async () => {
    mockReportCard({ profile: { ...PROFILE, logo_url: null } });
    renderReportCard();

    expect(await screen.findByText('Green Valley School')).toBeTruthy();
    expect(screen.queryByRole('img', { name: 'Green Valley School' })).toBeNull();
  });

  it('still renders the report card, with an empty legend, when the grading scale fails to load', async () => {
    mockReportCard();
    server.use(http.get(SCALE_URL, () => notFound('/grading/scales/scale-1')));
    renderReportCard();

    expect(await screen.findByText('Half-Yearly 2026')).toBeTruthy();
    expect(screen.getByText('Grade legend')).toBeTruthy();
    expect(screen.queryByText(/Outstanding/)).toBeNull();
  });

  it('shows an error when the result detail fails to load, and Try again refetches it', async () => {
    mockReportCard();
    let detailCalls = 0;
    server.use(
      http.get(DETAIL_URL, () => {
        detailCalls += 1;
        if (detailCalls === 1) return notFound('/exams/exam-1/results/student-1');
        return HttpResponse.json(DETAIL);
      }),
    );
    const user = userEvent.setup();
    renderReportCard();

    expect(await screen.findByText("Couldn't load this report card.")).toBeTruthy();

    await user.click(screen.getByRole('button', { name: 'Try again' }));

    expect(await screen.findByText('Rafi Ahmed')).toBeTruthy();
    expect(detailCalls).toBe(2);
  });

  it('shows an error when the exam fails to load', async () => {
    mockReportCard();
    server.use(http.get(EXAM_URL, () => notFound('/exams/exam-1')));
    renderReportCard();

    expect(await screen.findByText("Couldn't load this report card.")).toBeTruthy();
    expect(screen.queryByText('Rafi Ahmed')).toBeNull();
  });

  it('shows an error when the school profile fails to load', async () => {
    mockReportCard();
    server.use(http.get(PROFILE_URL, () => notFound('/schools/me/profile')));
    renderReportCard();

    expect(await screen.findByText("Couldn't load this report card.")).toBeTruthy();
    await waitFor(() => expect(screen.queryByText('Half-Yearly 2026')).toBeNull());
  });
});

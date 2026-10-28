/**
 * [19.8.1] The staff report-card route — one `RESULT_READ` card call
 * (exam, result, legend, school header) [#2922]. Same `renderWithRouter` + real route tree pattern as
 * `grading-scales/$scaleId.test.tsx`.
 */
import { toast } from '@biddaloy/ui/components';
import { REGION_BD_BN } from '@biddaloy/ui/i18n';
import { apiErrorBody, cleanupTestState, renderWithRouter, server } from '@biddaloy/ui/test';
import { formatNumber } from '@biddaloy/ui/utils';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { routeTree } from '../../../routeTree.gen';

const EXAM_URL = '/api/v1/exams/exam-1';
const CARD_URL = '/api/v1/students/student-1/results/exam-1';
const SCALE_URL = '/api/v1/grading/scales/scale-1';
const PROFILE_URL = '/api/v1/schools/me/profile';

const ISSUER = {
  name: 'Green Valley School',
  name_bn: null,
  address: null,
  phone: null,
  email: null,
  registration_id: null,
  logo_key: 'active',
};

const CARD = {
  exam_name: 'Half-Yearly 2026',
  student: { full_name: 'Rafi Ahmed', roll_number: 7 },
  result: {
    total_marks: 180,
    gpa: 4.5,
    grade: 'A',
    position: 3,
    is_fail: false,
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
  legend: [{ grade: 'A+', gpa: 5, comment: 'Outstanding' }],
  issuer: ISSUER,
  logo_url: 'https://cdn.example.com/logo.png' as string | null,
};

function notFound(path: string) {
  return HttpResponse.json(apiErrorBody(404, 'Not found', path), { status: 404 });
}

function forbidden(path: string) {
  return HttpResponse.json(apiErrorBody(403, 'Forbidden', path), { status: 403 });
}

/**
 * The page reads one RESULT_READ endpoint. The EXAM_MANAGE / GRADING_SCALE_MANAGE
 * / school-profile routes answer 403, as they do for a TEACHER or EXECUTIVE
 * (#2922): the card must render without them.
 */
function mockReportCard(overrides: { card?: Partial<typeof CARD> } = {}) {
  server.use(
    http.get(CARD_URL, () => HttpResponse.json({ ...CARD, ...overrides.card })),
    http.get(EXAM_URL, () => forbidden('/exams/exam-1')),
    http.get(SCALE_URL, () => forbidden('/grading/scales/scale-1')),
    http.get(PROFILE_URL, () => forbidden('/schools/me/profile')),
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

    // Header fact and the card itself.
    expect(await screen.findAllByText('Half-Yearly 2026')).toHaveLength(2);
    // Breadcrumb, header and the card itself.
    expect(screen.getAllByText('Rafi Ahmed')).toHaveLength(3);
    expect(screen.getByText('Green Valley School')).toBeTruthy();
    expect(screen.getByText('Mathematics')).toBeTruthy();
    // The school has a logo, so the header shows it.
    expect(screen.getByRole('img', { name: 'Green Valley School' }).getAttribute('src')).toBe(
      'https://cdn.example.com/logo.png',
    );
    // The legend comes from the grading scale the result was computed with.
    expect(
      await screen.findByText(
        `A+ (${formatNumber(5, REGION_BD_BN, { decimals: 2 })}) — Outstanding`,
      ),
    ).toBeTruthy();
    expect(screen.queryByRole('link', { name: 'Back to exam' })).toBeNull();
  });

  it('opens with the student name as the one h1, a Pass badge and the key facts', async () => {
    mockReportCard();
    renderReportCard();

    const h1 = await screen.findByRole('heading', { level: 1, name: 'Rafi Ahmed' });
    const header = within(h1.closest('header')!);
    expect(header.getByText('Pass')).toBeTruthy();
    expect(
      header.getByText(`${formatNumber(4.5, REGION_BD_BN, { decimals: 2 })} · A`),
    ).toBeTruthy();
    expect(header.getByText(formatNumber(7, REGION_BD_BN))).toBeTruthy();
    expect(header.getByText(formatNumber(3, REGION_BD_BN))).toBeTruthy();
    expect(header.getByText('Half-Yearly 2026')).toBeTruthy();
    // No back link, and "Print" is the header's one button.
    expect(screen.queryByRole('link', { name: 'Back to exam' })).toBeNull();
    expect(header.getAllByRole('button')).toHaveLength(1);
  });

  it('shows a Fail badge and a dash position for a failing, unranked student', async () => {
    mockReportCard();
    server.use(
      http.get(CARD_URL, () =>
        HttpResponse.json({
          ...CARD,
          result: { ...CARD.result, is_fail: true, position: null },
        }),
      ),
    );
    renderReportCard();

    const h1 = await screen.findByRole('heading', { level: 1, name: 'Rafi Ahmed' });
    const header = within(h1.closest('header')!);
    expect(header.getByText('Fail')).toBeTruthy();
    expect(header.queryByText('Pass')).toBeNull();
    expect(header.getByText('—')).toBeTruthy();
  });

  it('logs the print first, then opens the browser print dialog', async () => {
    const order: string[] = [];
    let body: unknown;
    const print = vi.fn(() => order.push('print'));
    vi.stubGlobal('print', print);
    mockReportCard();
    server.use(
      http.post('/api/v1/students/student-1/document-prints', async ({ request }) => {
        body = await request.json();
        order.push('log');
        return new HttpResponse(null, { status: 204 });
      }),
    );
    const user = userEvent.setup();
    renderReportCard();

    await user.click(await screen.findByRole('button', { name: 'Print' }));

    await waitFor(() => expect(print).toHaveBeenCalledTimes(1));
    expect(order).toEqual(['log', 'print']);
    expect(body).toEqual({ document: 'REPORT_CARD', exam_id: 'exam-1' });
  });

  it('shows an error and does not print when the print log fails', async () => {
    const print = vi.fn();
    vi.stubGlobal('print', print);
    const toastSpy = vi.spyOn(toast, 'error').mockImplementation(() => '');
    mockReportCard();
    server.use(
      http.post('/api/v1/students/student-1/document-prints', () =>
        HttpResponse.json(apiErrorBody(500, 'Boom', '/'), { status: 500 }),
      ),
    );
    const user = userEvent.setup();
    renderReportCard();

    try {
      await user.click(await screen.findByRole('button', { name: 'Print' }));
      await waitFor(() =>
        expect(toastSpy).toHaveBeenCalledWith(
          'The print could not be recorded, so it was not printed. Try again.',
        ),
      );
      expect(print).not.toHaveBeenCalled();
    } finally {
      toastSpy.mockRestore();
    }
  });

  it('shows no logo when the school has not uploaded one', async () => {
    mockReportCard({ card: { logo_url: null } });
    renderReportCard();

    expect(await screen.findByText('Green Valley School')).toBeTruthy();
    expect(screen.queryByRole('img', { name: 'Green Valley School' })).toBeNull();
  });

  it('renders the full card for a TEACHER although exam, grading-scale and profile routes answer 403', async () => {
    mockReportCard();
    renderWithRouter(routeTree, {
      initialEntries: ['/results/exam-1/student-1'],
      tenantId: 'tenant-1',
      role: 'TEACHER',
      locale: 'en',
    });

    expect(await screen.findAllByText('Half-Yearly 2026')).toHaveLength(2);
    expect(screen.getByText('Green Valley School')).toBeTruthy();
    expect(
      await screen.findByText(
        `A+ (${formatNumber(5, REGION_BD_BN, { decimals: 2 })}) — Outstanding`,
      ),
    ).toBeTruthy();
    expect(screen.queryByText("Couldn't load this report card.")).toBeNull();
  });

  it('shows an error when the card fails to load, and Retry refetches it', async () => {
    mockReportCard();
    let cardCalls = 0;
    server.use(
      http.get(CARD_URL, () => {
        cardCalls += 1;
        if (cardCalls === 1) return notFound('/students/student-1/results/exam-1');
        return HttpResponse.json(CARD);
      }),
    );
    const user = userEvent.setup();
    renderReportCard();

    expect(await screen.findByText("Couldn't load this report card.")).toBeTruthy();

    await user.click(screen.getByRole('button', { name: 'Retry' }));

    expect(await screen.findAllByText('Rafi Ahmed')).toHaveLength(3);
    expect(cardCalls).toBe(2);
  });
});

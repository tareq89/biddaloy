/**
 * [48.3.08] The chromeless `/print/document` route: report cards and transcripts are logged
 * before `window.print()`, a log failure blocks the print, bad URLs show the empty state.
 */
import { toast } from '@biddaloy/ui/components';
import { apiErrorBody, cleanupTestState, renderWithRouter, server } from '@biddaloy/ui/test';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { routeTree } from '../../../routeTree.gen';

const API = '/api/v1';
const EXAM_ID = '11111111-1111-4111-8111-111111111111';
const SECTION_ID = '22222222-2222-4222-8222-222222222222';
const STUDENT_ID = '33333333-3333-4333-8333-333333333333';
const YEAR_ID = '44444444-4444-4444-8444-444444444444';
const STUDENTS = ['s-1', 's-2', 's-3'];

const PROFILE = {
  name: 'Green Valley School',
  name_bn: null,
  address: null,
  phone: null,
  email: null,
  registration_id: null,
  logo_url: null,
};

const tabRow = (id: string, roll: number) => ({
  student_id: id,
  roll_number: roll,
  full_name: `Student ${roll}`,
  cells: {},
  total_marks: 80,
  gpa: 4,
  grade: 'A',
  section_position: roll,
  is_fail: false,
});

const detail = (id: string, roll: number) => ({
  student: { id, full_name: `Student ${roll}`, roll_number: roll },
  result: {
    total_marks: 80,
    gpa: 4,
    grade: 'A',
    position: roll,
    is_fail: false,
    grading_scale_id: 'sc',
  },
  subjects: [],
});

function mockBase() {
  server.use(
    http.get(`${API}/exams/${EXAM_ID}`, () =>
      HttpResponse.json({ id: EXAM_ID, name: 'Half-Yearly 2026', class_id: 'c1' }),
    ),
    http.get(`${API}/classes/c1`, () => HttpResponse.json({ id: 'c1', name: 'Eight' })),
    http.get(`${API}/schools/me/profile`, () => HttpResponse.json(PROFILE)),
    http.get(`${API}/exams/${EXAM_ID}/documents/tabulation`, () =>
      HttpResponse.json({
        exam: { id: EXAM_ID, name: 'Half-Yearly 2026', published_at: null },
        section: { id: SECTION_ID, name: 'A', class_name: 'Eight' },
        subjects: [],
        rows: STUDENTS.map((id, i) => tabRow(id, i + 1)),
      }),
    ),
    http.get(`${API}/grading/scales/sc`, () => HttpResponse.json({ id: 'sc', bands: [] })),
  );
}

function stubWidth(wide: boolean) {
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: wide,
    media: query,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
  }));
}

function render(search: string, wide = true) {
  stubWidth(wide);
  return renderWithRouter(routeTree, {
    initialEntries: [`/print/document?${search}`],
    tenantId: 'tenant-1',
    role: 'ADMIN',
    locale: 'en',
  });
}

describe('/print/document', () => {
  afterEach(async () => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    await cleanupTestState();
  });

  it('prints a whole section of report cards, each logged before window.print', async () => {
    mockBase();
    const order: string[] = [];
    const print = vi.spyOn(window, 'print').mockImplementation(() => void order.push('print'));
    server.use(
      ...STUDENTS.map((id, i) =>
        http.get(`${API}/exams/${EXAM_ID}/results/${id}`, () =>
          HttpResponse.json(detail(id, i + 1)),
        ),
      ),
      http.post(`${API}/students/:id/document-prints`, () => {
        order.push('log');
        return new HttpResponse(null, { status: 204 });
      }),
    );
    render(`doc=report-cards&exam_id=${EXAM_ID}&section_id=${SECTION_ID}`);

    const button = await screen.findByRole('button', { name: 'Print' });
    await waitFor(() => expect((button as HTMLButtonElement).disabled).toBe(false));
    await userEvent.click(button);
    await waitFor(() => expect(print).toHaveBeenCalled());
    expect(order).toEqual(['log', 'log', 'log', 'print']);
  });

  it('does not print when one report-card log fails', async () => {
    mockBase();
    const print = vi.spyOn(window, 'print').mockImplementation(() => undefined);
    const errorToast = vi.spyOn(toast, 'error').mockImplementation(() => '');
    let n = 0;
    server.use(
      ...STUDENTS.map((id, i) =>
        http.get(`${API}/exams/${EXAM_ID}/results/${id}`, () =>
          HttpResponse.json(detail(id, i + 1)),
        ),
      ),
      http.post(`${API}/students/:id/document-prints`, () =>
        ++n === 2
          ? HttpResponse.json(apiErrorBody(500, 'boom', '/x'), { status: 500 })
          : new HttpResponse(null, { status: 204 }),
      ),
    );
    render(`doc=report-cards&exam_id=${EXAM_ID}&section_id=${SECTION_ID}`);

    const button = await screen.findByRole('button', { name: 'Print' });
    await waitFor(() => expect((button as HTMLButtonElement).disabled).toBe(false));
    await userEvent.click(button);
    await waitFor(() => expect(errorToast).toHaveBeenCalled());
    expect(errorToast.mock.calls[0]?.[0]).toMatch(/could not be recorded/);
    expect(print).not.toHaveBeenCalled();
  });

  it('renders the tabulation with a Print button', async () => {
    mockBase();
    render(`doc=tabulation&exam_id=${EXAM_ID}&section_id=${SECTION_ID}`);
    expect(await screen.findByText('Student 1')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Print' })).toBeTruthy();
  });

  describe('transcript', () => {
    const search = `doc=transcript&student_id=${STUDENT_ID}&academic_year_id=${YEAR_ID}`;
    const mockTranscript = (logStatus: number, order: string[]) => {
      mockBase();
      server.use(
        http.get(`${API}/students/${STUDENT_ID}/transcript`, () =>
          HttpResponse.json({
            student: {
              id: STUDENT_ID,
              full_name: 'Rafi Ahmed',
              roll_number: 7,
              class_name: 'Eight',
              section_name: 'A',
            },
            academic_year: { id: YEAR_ID, name: '2026' },
            exams: [
              {
                ...detail('x', 1),
                exam_name: 'Half-Yearly',
                legend: [],
                issuer: PROFILE,
                logo_url: null,
              },
            ],
          }),
        ),
        http.post(`${API}/students/${STUDENT_ID}/document-prints`, () => {
          order.push('log');
          return logStatus === 204
            ? new HttpResponse(null, { status: 204 })
            : HttpResponse.json(apiErrorBody(500, 'boom', '/x'), { status: 500 });
        }),
      );
    };

    it('logs the print before window.print', async () => {
      const order: string[] = [];
      mockTranscript(204, order);
      vi.spyOn(window, 'print').mockImplementation(() => void order.push('print'));
      render(search);
      const button = await screen.findByRole('button', { name: 'Print' });
      await waitFor(() => expect((button as HTMLButtonElement).disabled).toBe(false));
      await userEvent.click(button);
      await waitFor(() => expect(order).toEqual(['log', 'print']));
    });

    it('does not print when the log fails', async () => {
      const order: string[] = [];
      mockTranscript(500, order);
      const print = vi.spyOn(window, 'print').mockImplementation(() => undefined);
      const errorToast = vi.spyOn(toast, 'error').mockImplementation(() => '');
      render(search);
      const button = await screen.findByRole('button', { name: 'Print' });
      await waitFor(() => expect((button as HTMLButtonElement).disabled).toBe(false));
      await userEvent.click(button);
      await waitFor(() => expect(errorToast).toHaveBeenCalled());
      expect(errorToast.mock.calls[0]?.[0]).toMatch(/could not be recorded/);
      expect(print).not.toHaveBeenCalled();
    });
  });

  it('shows the empty state when the exam id is missing', async () => {
    mockBase();
    render('doc=seat-list');
    expect(await screen.findByText('Nothing to print.')).toBeTruthy();
  });

  it('shows the desktop-only state on a phone', async () => {
    mockBase();
    render(`doc=tabulation&exam_id=${EXAM_ID}&section_id=${SECTION_ID}`, false);
    expect(await screen.findByRole('button', { name: 'Copy link' })).toBeTruthy();
  });
});

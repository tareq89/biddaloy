import {
  classFactory,
  cleanupTestState,
  examFactory,
  renderWithRouter,
  server,
} from '@biddaloy/ui/test';
import { screen, within } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { afterEach, describe, expect, it } from 'vitest';

import { routeTree } from '../../../../routeTree.gen';

/** [48.3.A-02] Print tab: cards by phase, one filled button, reasons + fix links, dues. */
describe('exams/$examId Print tab', () => {
  afterEach(async () => {
    await cleanupTestState();
  });

  const klass = classFactory({ id: 'class-7', name: 'Class 7' });
  const students = (dues: number, total = 20) =>
    Array.from({ length: total }, (_, i) => ({
      student_id: `s-${i}`,
      full_name: `Student ${i}`,
      roll_number: i + 1,
      section_name: 'A',
      printed_copies: i < 4 ? 1 : 0,
      last_printed_at: null,
      has_dues: i < dues ? true : null,
    }));

  function mock(opts: {
    status: 'DRAFT' | 'PROCESSED' | 'PUBLISHED';
    plan?: boolean;
    dues?: number;
    withhold?: boolean;
  }) {
    const exam = examFactory({
      id: 'exam-1',
      name: 'Half Yearly 2026',
      status: opts.status,
      class: klass,
      class_id: klass.id,
    });
    server.use(
      http.get('/api/v1/exams/:id', () => HttpResponse.json(exam)),
      http.get('/api/v1/classes/:id', () => HttpResponse.json(klass)),
      http.get('/api/v1/classes/:id/sections', () =>
        HttpResponse.json([
          { id: 'sec-a', section_name: 'A', enrolled_count: 20 },
          { id: 'sec-b', section_name: 'B', enrolled_count: 20 },
        ]),
      ),
      http.get('/api/v1/exams/:examId/schedule', () =>
        HttpResponse.json(opts.status === 'DRAFT' ? [] : [{ id: 'r1' }]),
      ),
      http.get('/api/v1/exams/:examId/components', () => HttpResponse.json([{ id: 'c1' }])),
      http.get('/api/v1/seat-plans', () =>
        HttpResponse.json(
          opts.plan
            ? [
                {
                  id: 'p1',
                  name: 'P',
                  status: 'PUBLISHED',
                  room_count: 4,
                  schedule_count: 9,
                  student_count: 20,
                },
              ]
            : [],
        ),
      ),
      http.get('/api/v1/exams/:examId/documents/admit-cards', () =>
        HttpResponse.json({
          withhold_for_dues: opts.withhold ?? true,
          seat_plan_published: opts.plan ?? false,
          students: students(opts.dues ?? 0),
        }),
      ),
    );
    return renderWithRouter(routeTree, {
      initialEntries: ['/exams/exam-1?tab=print'],
      tenantId: 'tenant-1',
      role: 'ADMIN',
      locale: 'en',
    });
  }

  const card = (name: string) =>
    screen.getByRole('heading', { name }).closest('section') as HTMLElement;

  it('published exam with a seat plan: every card enabled, only the admit card filled', async () => {
    mock({ status: 'PUBLISHED', plan: true });
    await screen.findByRole('heading', { name: 'Admit cards' });
    const filled = [...screen.getAllByRole('link'), ...screen.queryAllByRole('button')].filter(
      (el) => el.getAttribute('data-variant') === 'default',
    );
    // The tab body holds exactly one filled control: the admit card's.
    expect(filled.filter((el) => el.textContent === 'Print admit cards')).toHaveLength(1);
    const insideTab = filled.filter((el) => el.closest('[data-slot="document-card"]'));
    expect(insideTab.map((el) => el.textContent)).toEqual(['Print admit cards']);
    const seat = within(card('Seat list')).getByRole('link', { name: 'Print seat list' });
    expect(seat.getAttribute('href')).toContain('doc=seat-list');
    expect(seat.getAttribute('href')).toContain('exam_id=exam-1');
  });

  it('mark sheet link carries the doc and the preselected section', async () => {
    mock({ status: 'PUBLISHED', plan: true });
    await screen.findByRole('heading', { name: 'Mark sheet (report card)' });
    const href = within(card('Mark sheet (report card)'))
      .getByRole('link', { name: 'Print mark sheets' })
      .getAttribute('href');
    expect(href).toContain('doc=report-cards');
    expect(href).toContain('section_id=sec-a');
  });

  it('draft exam with no seat plan: seat documents disabled with a reason and a fix link', async () => {
    mock({ status: 'DRAFT' });
    await screen.findByRole('heading', { name: 'Seat list' });
    for (const title of ['Seat list', 'Invigilator sheet', 'Seat stickers', 'Admit cards']) {
      const c = card(title);
      expect(within(c).getByRole('button', { name: /print/i }).hasAttribute('disabled')).toBe(true);
      expect(within(c).getByText(/No published seat plan yet/)).toBeTruthy();
      expect(within(c).getByRole('link', { name: 'Make a seat plan' }).getAttribute('href')).toBe(
        '/exams/seat-plans?generate=1',
      );
    }
    expect(within(card('Tabulation sheet')).getByText(/not processed yet/)).toBeTruthy();
  });

  it('shows the dues warning with the number of students', async () => {
    mock({ status: 'PUBLISHED', plan: true, dues: 12 });
    const note = await screen.findByRole('status');
    expect(note.textContent).toContain('১২');
    expect(within(note).getByRole('link', { name: 'See who' })).toBeTruthy();
  });

  it('no dues warning when the setting is off', async () => {
    mock({ status: 'PUBLISHED', plan: true, dues: 0, withhold: false });
    await screen.findByRole('heading', { name: 'Admit cards' });
    expect(screen.queryByRole('status')).toBeNull();
  });
});

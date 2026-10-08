import '@biddaloy/ui/test';

import { REGION_BD_BN, REGION_BD_EN, RegionConfigProvider } from '@biddaloy/ui/i18n';
import { cleanupTestState, renderWithRouter, server } from '@biddaloy/ui/test';
import { createRootRoute, createRoute, Outlet } from '@tanstack/react-router';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { afterEach, describe, expect, it } from 'vitest';

import { PrintablesTabs } from './printables-tabs';
import { ToPrint } from './to-print';

const EXAM_A = '11111111-1111-4111-8111-111111111111';
const EXAM_B = '22222222-2222-4222-8222-222222222222';

const student = (id: string, roll: number, over: object = {}) => ({
  student_id: id,
  full_name: `Student ${id}`,
  roll_number: roll,
  section_name: 'A',
  printed_copies: 0,
  last_printed_at: null,
  has_dues: false,
  ...over,
});

const idRow = (id: string, has_photo: boolean) => ({
  student_id: id,
  full_name: `Pupil ${id}`,
  registration_number: `REG-${id}`,
  class_name: 'Six',
  section_name: 'A',
  admitted_on: '2026-09-03',
  has_photo,
});

interface Setup {
  exams?: { exam_id: string; exam_name: string; class_name: string; missing: number }[];
  ids?: ReturnType<typeof idRow>[];
  rosters?: Record<string, object[]>;
}

function serve({ exams = [], ids = [], rosters = {} }: Setup) {
  server.use(
    http.get('/api/v1/print-history/queue', () =>
      HttpResponse.json({
        total: exams.reduce((n, e) => n + e.missing, 0) + ids.length,
        by_kind: [],
        exams,
      }),
    ),
    http.get('/api/v1/print-history/queue/id-cards', () =>
      HttpResponse.json({ data: ids, total: ids.length, page: 1, limit: 100, totalPages: 1 }),
    ),
    http.get('/api/v1/exams/:id/documents/admit-cards', ({ params }) =>
      HttpResponse.json({
        withhold_for_dues: false,
        seat_plan_published: true,
        students: rosters[String(params.id)] ?? [],
      }),
    ),
  );
}

function render(role = 'ADMIN', locale: 'en' | 'bn' = 'en') {
  const root = createRootRoute({ component: Outlet });
  const index = createRoute({
    getParentRoute: () => root,
    path: '/',
    component: () => (
      <RegionConfigProvider value={locale === 'bn' ? REGION_BD_BN : REGION_BD_EN}>
        <ToPrint tabs={<PrintablesTabs value="to-print" onChange={() => undefined} />} />
      </RegionConfigProvider>
    ),
  });
  const view = renderWithRouter(root.addChildren([index]), { locale, role, tenantId: 'school-1' });
  return { ...view, user: userEvent.setup() };
}

const isFilled = (el: HTMLElement) => / bg-primary( |$)/.test(` ${el.className}`);

describe('ToPrint', () => {
  afterEach(async () => {
    await cleanupTestState();
  });

  it('shows a card per exam in the server order, with only the first print button filled', async () => {
    serve({
      exams: [
        { exam_id: EXAM_A, exam_name: 'Half-yearly', class_name: 'Eight', missing: 2 },
        { exam_id: EXAM_B, exam_name: 'Half-yearly', class_name: 'Nine', missing: 1 },
      ],
      rosters: {
        [EXAM_A]: [student('s1', 1), student('s2', 2, { has_dues: true })],
        [EXAM_B]: [student('s3', 1), student('s4', 2, { printed_copies: 1 })],
      },
      ids: [idRow('p1', true)],
    });
    render();
    const eight = await screen.findByRole('heading', { name: /Half-yearly · Eight/ });
    const nine = screen.getByRole('heading', { name: /Half-yearly · Nine/ });
    expect(eight.compareDocumentPosition(nine) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

    const first = await screen.findByRole('link', { name: 'Print 2 admit cards' });
    const second = await screen.findByRole('link', { name: 'Print 1 admit card' });
    const id = await screen.findByRole('link', { name: 'Print 1 ID card' });
    expect(isFilled(first)).toBe(true);
    expect(isFilled(second)).toBe(false);
    expect(isFilled(id)).toBe(false);
    // The one with dues is marked in the list and noted above it.
    expect(screen.getByText('Owes fees')).toBeTruthy();
    expect(screen.getByText('1 owe fees. They will print, marked in the list.')).toBeTruthy();
  });

  it('the admit-card link carries the exam and every waiting student', async () => {
    serve({
      exams: [{ exam_id: EXAM_A, exam_name: 'Half-yearly', class_name: 'Eight', missing: 2 }],
      rosters: { [EXAM_A]: [student('s2', 2), student('s1', 1)] },
    });
    render();
    const link = await screen.findByRole('link', { name: 'Print 2 admit cards' });
    const url = new URL(link.getAttribute('href')!, 'http://x');
    expect(url.pathname).toBe('/print/preview');
    expect(url.searchParams.get('kind')).toBe('EXAM_ADMIT_CARD');
    expect(url.searchParams.get('context_type')).toBe('EXAM');
    expect(url.searchParams.get('context_id')).toBe(EXAM_A);
    expect(url.searchParams.get('ids')).toBe('s1,s2');
    expect(url.searchParams.get('from')).toBe('/reports/printables?tab=to-print');
  });

  it('shows the first 5 waiting people and "show N more" opens the rest', async () => {
    serve({
      exams: [{ exam_id: EXAM_A, exam_name: 'Final', class_name: 'Ten', missing: 7 }],
      rosters: { [EXAM_A]: Array.from({ length: 7 }, (_, i) => student(`s${i + 1}`, i + 1)) },
    });
    const { user } = render();
    await screen.findByRole('link', { name: 'Print 7 admit cards' });
    expect(screen.getAllByRole('row').length).toBe(1 + 5);
    await user.click(screen.getByRole('button', { name: 'Show 2 more' }));
    expect(screen.getAllByRole('row').length).toBe(1 + 7);
  });

  it('the ID-card button leaves out students without a photo and says how many', async () => {
    serve({ ids: [idRow('p1', true), idRow('p2', false), idRow('p3', true)] });
    render();
    const link = await screen.findByRole('link', { name: 'Print 2 ID cards' });
    expect(new URL(link.getAttribute('href')!, 'http://x').searchParams.get('ids')).toBe('p1,p3');
    expect(screen.getByText('1 has no photo and will be left out.')).toBeTruthy();
    const add = screen.getByRole('link', { name: 'Add' });
    expect(add.getAttribute('href')).toContain('/students/p2');
    expect(add.getAttribute('href')).toContain('tab=documents');
    // With no exam waiting, the ID card button is the page's one filled button.
    expect(isFilled(link)).toBe(true);
  });

  it('an empty queue shows the empty state', async () => {
    serve({});
    render();
    expect(await screen.findByText('Nothing waiting to be printed.')).toBeTruthy();
  });

  it('the To print tab and its count are hidden for an EXECUTIVE', async () => {
    serve({ ids: [idRow('p1', true)] });
    render('EXECUTIVE');
    await screen.findByRole('tab', { name: /Print history/ });
    expect(screen.queryByRole('tab', { name: /To print/ })).toBeNull();
  });

  it('the tab shows the waiting count, with keyboard arrows moving between tabs, in Bangla digits', async () => {
    serve({ ids: [idRow('p1', true)] });
    const { user } = render('ADMIN', 'bn');
    const tab = await screen.findByRole('tab', { name: /প্রিন্ট বাকি/ });
    await waitFor(() => expect(within(tab).getByText('১')).toBeTruthy());
    const history = screen.getByRole('tab', { name: /ছাপার ইতিহাস/ });
    history.focus();
    await user.keyboard('{ArrowRight}');
    expect(document.activeElement).toBe(screen.getByRole('tab', { name: /সনদ রেজিস্টার/ }));
  });

  it('is axe clean', async () => {
    serve({
      exams: [{ exam_id: EXAM_A, exam_name: 'Final', class_name: 'Ten', missing: 1 }],
      rosters: { [EXAM_A]: [student('s1', 1)] },
      ids: [idRow('p1', false)],
    });
    const { container } = render();
    await screen.findByRole('link', { name: 'Print 1 admit card' });
    await expect(container).toHaveNoViolations();
  });
});

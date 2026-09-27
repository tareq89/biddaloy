/**
 * [34.4.1] `StudentsTab`: renders an enrolled student row, expands it to a
 * `MilestoneChecklist`, ticks a milestone, and opens the status menu to
 * withdraw. Same hand-rolled provider stack as `-record-dialog.test.tsx`.
 */
import { setActiveRole, setActiveTenant } from '@biddaloy/ui/api';
import { I18nProvider, i18n } from '@biddaloy/ui/i18n';
import { cleanupTestState, createTestQueryClient, server } from '@biddaloy/ui/test';
import { QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { StudentsTab } from './-students-tab';

afterEach(async () => {
  await cleanupTestState();
});

const ENROLLMENTS = [
  {
    id: 'enr-1',
    status: 'ACTIVE',
    started_on: '2026-01-01',
    ended_on: null,
    student: { id: 'student-1', full_name: 'Anika Rahman', roll_number: '12' },
    achieved_count: 0,
    milestone_total: 1,
  },
];

const STUDENT_PROGRAMS = [
  {
    program: { id: 'p-1', name: 'Reading Club' },
    milestones: [{ id: 'm-1', name: 'Read 5 books', sequence: 1, achievement: null }],
  },
];

async function renderTab(onOpenEnrol = vi.fn(), canManage = true) {
  await i18n.changeLanguage('en');
  setActiveTenant('tenant-1');
  setActiveRole('ADMIN');

  server.use(
    http.get('/api/v1/programs/:id/enrollments', () => HttpResponse.json(ENROLLMENTS)),
    http.get('/api/v1/students/:id/programs', () => HttpResponse.json(STUDENT_PROGRAMS)),
  );

  const queryClient = createTestQueryClient();
  const view = render(
    <QueryClientProvider client={queryClient}>
      <I18nProvider>
        <StudentsTab
          programId="p-1"
          milestoneTotal={1}
          canManage={canManage}
          onOpenEnrol={onOpenEnrol}
        />
      </I18nProvider>
    </QueryClientProvider>,
  );

  return { ...view, onOpenEnrol };
}

describe('StudentsTab', () => {
  it('renders the enrolled student row with progress', async () => {
    await renderTab();
    await screen.findByText('Anika Rahman');
    expect(screen.getByText('0 / 1')).toBeTruthy();
  });

  it('opens the enrol dialog trigger', async () => {
    const user = userEvent.setup();
    const { onOpenEnrol } = await renderTab();
    await screen.findByText('Anika Rahman');
    await user.click(screen.getByRole('button', { name: 'Enrol' }));
    expect(onOpenEnrol).toHaveBeenCalled();
  });

  it('expands a row and ticks a milestone', async () => {
    const user = userEvent.setup();
    let requestBody: unknown;
    server.use(
      http.post('/api/v1/programs/:id/achievements', async ({ request }) => {
        requestBody = await request.json();
        return HttpResponse.json({ upserted: 1 });
      }),
    );
    await renderTab();
    await screen.findByText('Anika Rahman');

    const toggle = screen.getByRole('button', { name: /Anika Rahman/ });
    await user.click(toggle);
    expect(toggle.getAttribute('aria-expanded')).toBe('true');

    const checkbox = await screen.findByRole('checkbox');
    await user.click(checkbox);

    await waitFor(() => expect(requestBody).toMatchObject({ milestone_id: 'm-1' }));
  });

  it('withdraws a student via the row menu', async () => {
    const user = userEvent.setup();
    let patchBody: unknown;
    server.use(
      http.patch('/api/v1/program-enrollments/:id', async ({ request }) => {
        patchBody = await request.json();
        return HttpResponse.json({ status: 'WITHDRAWN' });
      }),
    );
    await renderTab();
    await screen.findByText('Anika Rahman');

    await user.click(screen.getByRole('button', { name: 'Mark complete' }));
    await user.click(await screen.findByText('Withdraw'));

    await waitFor(() => expect(patchBody).toMatchObject({ status: 'WITHDRAWN' }));
  });

  it('shows the empty state when there are no enrollments', async () => {
    await i18n.changeLanguage('en');
    setActiveTenant('tenant-1');
    setActiveRole('ADMIN');
    server.use(http.get('/api/v1/programs/:id/enrollments', () => HttpResponse.json([])));

    const queryClient = createTestQueryClient();
    render(
      <QueryClientProvider client={queryClient}>
        <I18nProvider>
          <StudentsTab programId="p-1" milestoneTotal={1} canManage onOpenEnrol={vi.fn()} />
        </I18nProvider>
      </QueryClientProvider>,
    );

    await screen.findByText('No students enrolled in this program yet');
  });

  it('hides manage-only controls (Enrol, status menu) for a PROGRAM_RECORD-only viewer', async () => {
    await renderTab(vi.fn(), false);
    await screen.findByText('Anika Rahman');

    expect(screen.queryByRole('button', { name: 'Enrol' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Mark complete' })).toBeNull();
    // Record stays available to a PROGRAM_RECORD-only viewer.
    expect(screen.getAllByRole('button', { name: 'Record achievement' }).length).toBeGreaterThan(0);
  });
});

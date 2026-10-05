/**
 * [16.7.5] `/fees/schedules` — the rules list, the URL-driven rule form (`?new=1` / `?edit=<id>`),
 * the switch-on/off confirm, and B10 (no programs request without `PROGRAM_READ`).
 */
import { cleanupTestState, renderWithRouter, server } from '@biddaloy/ui/test';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { routeTree } from '../../../../routeTree.gen';

// The default test RegionConfig is Bangla; pin REGION_BD_EN for this page so assertions read in
// Latin digits.
vi.mock('@biddaloy/ui/i18n', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@biddaloy/ui/i18n')>();
  return { ...actual, useRegionConfig: () => actual.REGION_BD_EN };
});

function rule(overrides: Record<string, unknown> = {}) {
  return {
    id: 'schedule-1',
    name: 'Monthly tuition',
    academic_year_id: 'year-1',
    fee_structure_ids: ['fee-1'],
    audience: { enrollment_status: 'ACTIVE' },
    rule: { kind: 'MONTHLY', day_of_month: 1 },
    period_type: 'MONTH',
    due_days_after_period_start: 7,
    starts_on: '2026-01-01',
    ends_on: '',
    notify_families: false,
    is_active: true,
    last_run_period: '2026-10-01',
    created_at: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function listHandler(rows: Record<string, unknown>[]) {
  return http.get('/api/v1/fees/schedules', () => HttpResponse.json(rows));
}

function render(role = 'ADMIN', entry = '/fees/schedules') {
  return renderWithRouter(routeTree, {
    initialEntries: [entry],
    tenantId: 'tenant-1',
    role,
    locale: 'en',
  });
}

describe('/fees/schedules', () => {
  afterEach(async () => {
    await cleanupTestState();
  });

  it('shows plain-language rows: when, last billed month, status badge, a never-billed muted label', async () => {
    server.use(
      listHandler([
        rule(),
        rule({
          id: 'schedule-2',
          name: 'Weekly transport',
          rule: { kind: 'WEEKLY', weekdays: [7, 3] },
          is_active: false,
          last_run_period: null,
        }),
      ]),
    );

    render();

    await screen.findByText('Monthly tuition');
    expect(screen.getByText('Every month on day 1')).toBeTruthy();
    expect(screen.getByText('Every Sun and Wed')).toBeTruthy();
    expect(screen.getByText('October 2026')).toBeTruthy();
    expect(screen.getByText('Not yet')).toBeTruthy();
    expect(screen.getByText('Active')).toBeTruthy();
    expect(screen.getByText('Inactive')).toBeTruthy();
    // Subtitle says once that only active students are billed.
    expect(
      screen.getByText('Bills for active students are created on their own, on the rule you set.'),
    ).toBeTruthy();
    // The name is plain text, not a link.
    expect(screen.queryByRole('link', { name: 'Monthly tuition' })).toBeNull();
  });

  it('the header "Add rule" button opens the form through ?new=1', async () => {
    server.use(listHandler([rule()]));

    const { router } = render();
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Add rule' }));

    await waitFor(() => expect(router.state.location.search).toMatchObject({ new: 1 }));
    expect(
      await screen.findByRole('heading', { level: 1, name: 'New automatic billing rule' }),
    ).toBeTruthy();
  });

  it('the Edit action opens the form for that rule through ?edit=<id>', async () => {
    server.use(listHandler([rule()]));

    const { router } = render();
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Edit' }));

    await waitFor(() => expect(router.state.location.search).toMatchObject({ edit: 'schedule-1' }));
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Edit automatic billing rule' }),
    ).toBeTruthy();
  });

  it('switching a rule off asks first, and only the confirm sends the PATCH', async () => {
    let patched: Record<string, unknown> | null = null;
    server.use(
      listHandler([rule()]),
      http.patch('/api/v1/fees/schedules/:id', async ({ request }) => {
        patched = (await request.json()) as Record<string, unknown>;
        return HttpResponse.json(rule({ is_active: false }));
      }),
    );

    render();
    const user = userEvent.setup();
    // View, Edit and Copy are the three inline icons; Deactivate sits in the More menu.
    await user.click(await screen.findByRole('button', { name: 'More actions' }));
    await user.click(await screen.findByRole('menuitem', { name: 'Deactivate' }));

    const dialog = within(await screen.findByRole('alertdialog'));
    expect(dialog.getByText('Deactivate this schedule?')).toBeTruthy();
    expect(patched).toBeNull();

    await user.click(dialog.getByRole('button', { name: 'Deactivate' }));
    await waitFor(() => expect(patched).toEqual({ is_active: false }));
  });

  it('B10: a role without PROGRAM_READ makes no programs request', async () => {
    let programsRequested = false;
    server.use(
      listHandler([rule()]),
      http.get('/api/v1/programs', () => {
        programsRequested = true;
        return HttpResponse.json([]);
      }),
    );

    render('ACCOUNTANT');

    await screen.findByText('Monthly tuition');
    expect(programsRequested).toBe(false);
  });

  it('names the program in "Who is billed" for a program-scoped rule', async () => {
    server.use(
      listHandler([
        rule({ audience: { enrollment_status: 'ACTIVE', program_id: 'program-hifz' } }),
      ]),
      http.get('/api/v1/programs', () =>
        HttpResponse.json([{ id: 'program-hifz', name: 'Hifz', is_active: true }]),
      ),
    );

    render();

    expect(await screen.findByText('Whole school · Hifz')).toBeTruthy();
  });

  it('shows the empty state with an add action when there are no rules', async () => {
    server.use(listHandler([]));

    render();

    expect(await screen.findByText('No automatic billing rules yet')).toBeTruthy();
    expect(
      screen.getByText('Add a rule and bills are created every month or week on their own.'),
    ).toBeTruthy();
  });
});

import { UserRole } from '@biddaloy/shared';
import { cleanupTestState, renderWithRouter, server } from '@biddaloy/ui/test';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { afterEach, describe, expect, it } from 'vitest';

import { routeTree } from '../../../routeTree.gen';

/** The owner's schools list. Every case renders as SUPER_ADMIN; `_platform.access.test.tsx`
 * covers the role gate itself. Rows come from the default `/platform/schools/search` handler. */
const render = (path = '/schools') =>
  renderWithRouter(routeTree, {
    initialEntries: [path],
    tenantId: 'tenant-1',
    role: UserRole.SUPER_ADMIN,
    locale: 'en',
  });

const schoolsRegion = () =>
  screen.findByRole('region', { name: 'Table of all schools on the platform' });

const PAGE_ONE_SCHOOL = {
  id: '11111111-1111-4111-8111-111111111111',
  name: 'Page One School',
  slug: 'page-one',
  status: 'ACTIVE',
  statusReason: null,
  createdAt: '2029-01-01T00:00:00.000Z',
  studentCount: 1,
  lastActivityAt: null,
  trialEndsAt: null,
  seatLimit: null,
  deletedAt: null,
};

describe('/schools', () => {
  afterEach(async () => {
    await cleanupTestState();
  });

  it('lists schools with status, students, last active and trial columns', async () => {
    render();
    await screen.findByRole('heading', { name: 'Schools' });
    const region = await schoolsRegion();
    await waitFor(() => expect(within(region).getAllByRole('row')).toHaveLength(5)); // header + 4
    const row = within(region).getByText('Rose Valley School').closest('tr') as HTMLElement;
    expect(within(row).getByText('Active')).toBeTruthy();
    expect(within(row).getByText(/^(120|১২০)$/)).toBeTruthy();
    expect(within(row).getByText('No trial')).toBeTruthy();
    expect(within(region).getByRole('columnheader', { name: /Trial ends/ })).toBeTruthy();
  });

  it('puts search, status, trial and sort in the URL and in the query', async () => {
    const seen: URLSearchParams[] = [];
    server.use(
      http.get('*/platform/schools/search', ({ request }) => {
        seen.push(new URL(request.url).searchParams);
        return HttpResponse.json({ items: [], total: 0 });
      }),
    );
    render('/schools?q=rose&status=SUSPENDED&trial=expired&sort=students');

    await screen.findByText('No schools match your search.');
    const last = seen[seen.length - 1]!;
    expect(last.get('q')).toBe('rose');
    expect(last.get('status')).toBe('SUSPENDED');
    expect(last.get('trial')).toBe('expired');
    expect(last.get('sort')).toBe('students');
  });

  it('pages through the list: the page is in the URL and in the query', async () => {
    const user = userEvent.setup();
    const seen: (string | null)[] = [];
    server.use(
      http.get('*/platform/schools/search', ({ request }) => {
        seen.push(new URL(request.url).searchParams.get('page'));
        const items = [PAGE_ONE_SCHOOL];
        return HttpResponse.json({ items, total: 60 });
      }),
    );
    render();
    await user.click(await screen.findByRole('button', { name: /next/i }));
    await waitFor(() => expect(seen).toContain('2'));
  });

  it('clicking the sorted column again clears the sort', async () => {
    const user = userEvent.setup();
    const seen: (string | null)[] = [];
    server.use(
      http.get('*/platform/schools/search', ({ request }) => {
        seen.push(new URL(request.url).searchParams.get('sort'));
        return HttpResponse.json({ items: [PAGE_ONE_SCHOOL], total: 1 });
      }),
    );
    render('/schools?sort=name');
    await screen.findByText('Page One School');
    await user.click(screen.getByRole('button', { name: 'Name' }));
    await waitFor(() => expect(seen[seen.length - 1]).toBeNull());
  });

  it('typing in search changes the query', async () => {
    const user = userEvent.setup();
    const seen: (string | null)[] = [];
    server.use(
      http.get('*/platform/schools/search', ({ request }) => {
        seen.push(new URL(request.url).searchParams.get('q'));
        return HttpResponse.json({ items: [], total: 0 });
      }),
    );
    render();
    await user.type(await screen.findByLabelText('Search school or phone'), 'zen');
    await waitFor(() => expect(seen).toContain('zen'));
  });

  it('shows the error state when the list cannot load', async () => {
    server.use(http.get('*/platform/schools/search', () => HttpResponse.json({}, { status: 500 })));
    render();
    expect(await screen.findByText('Could not load schools.')).toBeTruthy();
  });

  it('has a primary "New school" button', async () => {
    const user = userEvent.setup();
    render();
    await screen.findByText('Rose Valley School');
    await user.click(screen.getByRole('button', { name: 'New school' }));
    expect(await screen.findByRole('heading', { name: 'New school', level: 1 })).toBeTruthy();
  });

  it('Login as opens the dialog for that school', async () => {
    const user = userEvent.setup();
    render();
    await screen.findByText('Green Hill School');
    await user.click(screen.getAllByRole('button', { name: 'Login as for Green Hill School' })[0]!);
    expect(await screen.findByRole('dialog', { name: /Green Hill School/ })).toBeTruthy();
  });

  it('shows the live strip and End asks first, then ends that one', async () => {
    const user = userEvent.setup();
    const ended: string[] = [];
    server.use(
      http.delete('*/platform/impersonation/:id', ({ params }) => {
        ended.push(String(params.id));
        return new HttpResponse(null, { status: 204 });
      }),
    );
    render();
    await screen.findByText(/Anika Rahman, Teacher - [\d০-৯,]+ min left/);
    await user.click(
      screen.getByRole('button', { name: "End Anika Rahman's visit to Rose Valley School" }),
    );
    await user.click(await screen.findByRole('button', { name: 'End' }));
    await waitFor(() => expect(ended).toHaveLength(1));
  });

  it('ending a visit takes it off the strip (mock state)', async () => {
    const user = userEvent.setup();
    render();
    await user.click(
      await screen.findByRole('button', { name: "End Anika Rahman's visit to Rose Valley School" }),
    );
    await user.click(await screen.findByRole('button', { name: 'End' }));
    await waitFor(() => expect(screen.queryByText(/Anika Rahman, Teacher/)).toBeNull());
  });

  it('says the live list failed to load instead of hiding it', async () => {
    server.use(http.get('*/platform/impersonation', () => HttpResponse.json({}, { status: 500 })));
    render();
    expect(await screen.findByText('Could not load who is signed in.')).toBeTruthy();
  });

  it('hides the live strip when no one is signed in', async () => {
    server.use(http.get('*/platform/impersonation', () => HttpResponse.json([])));
    render();
    await screen.findByText('Rose Valley School');
    expect(screen.queryByText(/Live now/)).toBeNull();
  });

  it('renders the backup health table, including a "Never" row for a school with no export', async () => {
    render();
    await screen.findByRole('heading', { name: 'Backup status' });
    const healthRegion = await screen.findByRole('region', {
      name: 'Table of backup status per school',
    });
    expect(within(healthRegion).getByText('Backup Health Fixture School A')).toBeTruthy();
    const neverRow = within(healthRegion)
      .getByText('Backup Health Fixture School B')
      .closest('tr') as HTMLElement;
    expect(within(neverRow).getAllByText('Never')).toHaveLength(2);
  });

  it('renders the alert engine health card under the schools list', async () => {
    server.use(
      http.get('*/platform/attention/health', () =>
        HttpResponse.json({
          lastSweep: { FAST: new Date().toISOString(), HOURLY: null, DAILY: null },
          durationsMs: { FAST: 1500, HOURLY: null, DAILY: null },
          failingRules: [],
        }),
      ),
    );
    render();
    expect(await screen.findByRole('heading', { name: 'Alert engine', level: 2 })).toBeTruthy();
    expect(await screen.findByText('Running')).toBeTruthy();
  });

  it('shows a loading state while the list is in flight', async () => {
    server.use(
      http.get(
        '*/platform/schools/search',
        () =>
          new Promise((resolve) =>
            setTimeout(() => resolve(HttpResponse.json({ items: [], total: 0 })), 50),
          ),
      ),
    );
    render();
    await screen.findByRole('heading', { name: 'Schools' });
    const region = screen.getByRole('region', { name: 'Table of all schools on the platform' });
    expect(region.getAttribute('aria-busy')).toBe('true');
    expect(await screen.findByText('No schools match your search.')).toBeTruthy();
  });
});

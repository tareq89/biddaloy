import { ApplicationStatus, ApplicationType, Permission } from '@biddaloy/shared';
import type { ApplicationListItemDto } from '@biddaloy/ui/hooks';
import { cleanupTestState, renderWithRouter, server } from '@biddaloy/ui/test';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { routeTree } from '../../../routeTree.gen';

const deny = vi.hoisted(() => ({ manage: false }));
vi.mock('@biddaloy/ui/hooks', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@biddaloy/ui/hooks')>();
  return {
    ...actual,
    useHasPermission: (p: Permission) =>
      !(deny.manage && p === Permission.APPLICATION_MANAGE) && actual.useHasPermission(p),
  };
});

afterEach(async () => {
  deny.manage = false;
  await cleanupTestState();
});

const [A1, A2, A3] = [1, 2, 3].map((n) => `00000000-0000-4000-8000-00000000000${n}`) as [
  string,
  string,
  string,
];

const row = (id: string, extra: Partial<ApplicationListItemDto> = {}): ApplicationListItemDto =>
  ({
    id,
    serial: '2026/0045',
    serial_year: 2026,
    serial_no: 45,
    type: ApplicationType.STUDENT_LEAVE,
    status: ApplicationStatus.PENDING,
    source: 'ONLINE',
    applicant_name: `Applicant ${id}`,
    subject_kind: 'STUDENT',
    subject_name: `Student ${id}`,
    subject_class_name: 'Six',
    subject_section_name: 'A',
    subject_roll: '12',
    subject_designation: null,
    payload: { reason: 'x' },
    ref_names: {},
    start_date: '2026-10-08',
    end_date: '2026-10-09',
    addressee_name: null,
    current_step: 0,
    step_count: 2,
    created_at: '2026-10-07T04:00:00.000Z',
    can: { decide: true, consider: true, withdraw: false, cancel: false, comment: true },
    ...extra,
  }) as unknown as ApplicationListItemDto;

function mockApi(opts: {
  pending?: number;
  rows?: ApplicationListItemDto[] | (() => ApplicationListItemDto[]);
  onList?: (url: URL) => void;
  onBulk?: (body: { ids: string[] }) => unknown;
  fail?: boolean;
}) {
  server.use(
    http.get('/api/v1/applications/pending-count', () =>
      HttpResponse.json({
        total: opts.pending ?? 0,
        by_type: [],
        oldest_pending_at: opts.pending ? '2026-10-01T00:00:00.000Z' : null,
      }),
    ),
    http.get('/api/v1/applications', ({ request }) => {
      opts.onList?.(new URL(request.url));
      if (opts.fail) return HttpResponse.json({ message: 'boom' }, { status: 500 });
      const data = typeof opts.rows === 'function' ? opts.rows() : (opts.rows ?? []);
      return HttpResponse.json({ data, total: data.length, page: 1, limit: 25, totalPages: 1 });
    }),
    http.post('/api/v1/applications/bulk-approve', async ({ request }) =>
      HttpResponse.json(opts.onBulk?.((await request.json()) as { ids: string[] }) ?? []),
    ),
  );
}

function mount(search = '', locale: 'en' | 'bn' = 'en') {
  return renderWithRouter(routeTree, {
    initialEntries: [`/applications${search}`],
    tenantId: 'tenant-1',
    role: 'ADMIN',
    locale,
  });
}

describe('/applications', () => {
  it('inbox shows the serial in Latin digits, step label and warning badge; all tab needs APPLICATION_MANAGE', async () => {
    mockApi({ pending: 1, rows: [row(A1)] });
    deny.manage = true;
    mount('?view=inbox');
    expect(await screen.findByText('2026/0045')).toBeTruthy();
    expect(screen.getAllByText('Pending').length).toBeGreaterThan(0);
    expect(screen.getAllByText(/[1১]\/[2২]/).length).toBeGreaterThan(0);
    expect(screen.queryByRole('tab', { name: 'All applications' })).toBeNull();
    expect(screen.getByRole('tab', { name: /Awaiting decision/ })).toBeTruthy();
  });

  it('defaults to inbox when something is pending, mine when nothing is', async () => {
    mockApi({ pending: 2, rows: [] });
    const first = mount();
    await waitFor(() =>
      expect(
        screen.getByRole('tab', { name: /Awaiting decision/ }).getAttribute('data-state'),
      ).toBe('active'),
    );
    first.unmount();
    await cleanupTestState();
    mockApi({ pending: 0, rows: [] });
    mount();
    await waitFor(() =>
      expect(screen.getByRole('tab', { name: 'My applications' }).getAttribute('data-state')).toBe(
        'active',
      ),
    );
  });

  const CLASS_ID = 'c1c1c1c1-0000-4000-8000-000000000001';

  it('a class filter writes class_id to the URL and refetches with it', async () => {
    const urls: URL[] = [];
    mockApi({ pending: 1, rows: [row(A1)], onList: (u) => urls.push(u) });
    const { router } = mount(`?view=inbox&class_id=${CLASS_ID}`);
    await screen.findByText('2026/0045');
    await waitFor(() =>
      expect(urls.some((u) => u.searchParams.get('class_id') === CLASS_ID)).toBe(true),
    );
    expect(router.state.location.search).toMatchObject({ class_id: CLASS_ID });
  });

  it('bulk approve drops FEE_WAIVER, sends 2 ids and lists the failed row in plain words', async () => {
    const user = userEvent.setup();
    let sent: string[] = [];
    mockApi({
      pending: 3,
      rows: [
        row(A1, { applicant_name: 'Alice' }),
        row(A2, { applicant_name: 'Bob', serial: '2026/0046' }),
        row(A3, { type: ApplicationType.FEE_WAIVER, payload: { kind: 'PERCENT', value: 50 } }),
      ],
      onBulk: (body) => {
        sent = body.ids;
        return [
          { id: A1, ok: true },
          { id: A2, ok: false, error_code: 'NOT_A_DECIDER' },
        ];
      },
    });
    mount('?view=inbox');
    await screen.findAllByText('Alice');
    await user.click(screen.getAllByRole('checkbox', { name: 'Select all rows on page' })[0]!);
    const btn = await screen.findByRole('button', { name: 'Approve selected' });
    await user.click(btn);
    const dialog = await screen.findByRole('alertdialog');
    expect(
      within(dialog).getByText(/fee waiver application\(s\) cannot be approved together/),
    ).toBeTruthy();
    await user.click(within(dialog).getByRole('button', { name: 'Approve' }));
    await waitFor(() => expect(sent).toEqual([A1, A2]));
    const status = await screen.findByRole('status');
    expect(within(status).getByText(/[1১] of [2২] approved/)).toBeTruthy();
    expect(
      within(status).getByText(/Bob · 2026\/0046 — You do not decide this application/),
    ).toBeTruthy();
  });

  it('row approve links carry from=inbox&decide=approve; view carries from=inbox only on inbox', async () => {
    mockApi({ pending: 1, rows: [row(A1)] });
    const { unmount } = mount('?view=inbox');
    const approve = await screen.findAllByRole('link', { name: 'Approve application 2026/0045' });
    expect(approve[0]!.getAttribute('href')).toContain(
      `/applications/${A1}?from=inbox&decide=approve`,
    );
    const view = screen.getAllByRole('link', { name: 'Open application 2026/0045' });
    expect(view[0]!.getAttribute('href')).toContain('from=inbox');
    unmount();
    await cleanupTestState();
    mockApi({ pending: 1, rows: [row(A1)] });
    mount('?view=mine');
    const mine = await screen.findAllByRole('link', { name: 'Open application 2026/0045' });
    expect(mine[0]!.getAttribute('href')).not.toContain('from=inbox');
  });

  it('after ?decided=a2 the successor row gets focus and decided leaves the URL (D25)', async () => {
    let list = [row(A1), row(A2, { serial: '2026/0046' }), row(A3, { serial: '2026/0047' })];
    mockApi({ pending: 3, rows: () => list });
    const { router, queryClient } = mount('?view=inbox');
    await screen.findAllByText('2026/0047');
    // Leave for the detail page (here: the new-application stub), decide, come back.
    await router.navigate({ to: '/applications/new' });
    list = [list[0]!, list[2]!];
    // What the decision mutation does.
    await queryClient.invalidateQueries({ queryKey: ['applications'] });
    await router.navigate({
      to: '/applications',
      search: { view: 'inbox', decided: A2 },
    });
    await waitFor(
      () => expect(document.activeElement?.getAttribute('data-focus-anchor')).toBe(A3),
      {
        timeout: 3000,
      },
    );
    await waitFor(() => expect(router.state.location.search).not.toHaveProperty('decided'));
  });

  it('empty inbox after a decision keeps focus on the page heading (D25)', async () => {
    let list = [row(A1)];
    mockApi({ pending: 1, rows: () => list });
    const { router, queryClient } = mount('?view=inbox');
    await screen.findAllByText('2026/0045');
    await router.navigate({ to: '/applications/new' });
    list = [];
    await queryClient.invalidateQueries({ queryKey: ['applications'] });
    await router.navigate({ to: '/applications', search: { view: 'inbox', decided: A1 } });
    await waitFor(() => expect(document.activeElement?.tagName).toBe('H1'), { timeout: 3000 });
    await waitFor(() => expect(router.state.location.search).not.toHaveProperty('decided'));
  });

  it('shows empty, error and no-results states', async () => {
    mockApi({ pending: 0, rows: [] });
    mount('?view=inbox');
    expect(await screen.findByText('Every application has been decided')).toBeTruthy();
  });

  it('renders the error state with a retry', async () => {
    mockApi({ pending: 1, fail: true });
    mount('?view=inbox');
    expect(
      await screen.findByText('Could not load applications.', {}, { timeout: 8000 }),
    ).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Retry' })).toBeTruthy();
  }, 15000);

  it('filters with no match show the no-results state', async () => {
    mockApi({ pending: 0, rows: [] });
    mount('?view=mine&q=zzz');
    expect(await screen.findByText('No application matches these filters')).toBeTruthy();
  });

  it('sets the document title', async () => {
    mockApi({ pending: 0, rows: [] });
    mount('?view=mine', 'bn');
    await waitFor(() => expect(document.title).toBe('আবেদনপত্র · SchoolManager'));
  });
});

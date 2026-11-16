import { cleanupTestState, renderWithRouter, server } from '@biddaloy/ui/test';
import { toLatinDigits } from '@biddaloy/ui/utils';
import { createRootRoute, createRoute } from '@tanstack/react-router';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { afterEach, describe, expect, it } from 'vitest';

import { PublicationPanel } from './PublicationPanel';

afterEach(async () => {
  await cleanupTestState();
});

const root = createRootRoute();
const tree = root.addChildren([
  createRoute({
    getParentRoute: () => root,
    path: '/rounds/$roundId',
    component: PublicationPanel,
  }),
]);

const listRow = (id: string, kind: string, sequence: number) => ({
  id,
  kind,
  sequence,
  order_by: 'MERIT',
  capacity: 10,
  act_by_date: null,
  activated_at: null,
  counts: { OFFERED: 0, WAITING: 0, ADMITTED: 0, EXPIRED: 0 },
  members: [],
});

function setup(over: { published?: string[]; available?: number } = {}) {
  const state = {
    names: false,
    posts: 0,
    bodies: [] as unknown[],
    keys: [] as (string | null)[],
    estimateQueries: [] as string[],
  };
  server.use(
    http.get('/api/v1/admission-intakes/r1', () =>
      HttpResponse.json({
        id: 'r1',
        publish_channels: ['SITE', 'SMS'],
        show_names_publicly: state.names,
      }),
    ),
    http.get('/api/v1/admission-intakes/r1/stages', () =>
      HttpResponse.json([
        { id: 's1', intake_id: 'r1', position: 1, kind: 'WRITTEN', title: null, config: {} },
      ]),
    ),
    http.get('/api/v1/admission/intakes/r1/lists', () =>
      HttpResponse.json({
        seat_count: 10,
        seats_left: 10,
        lists: [listRow('m1', 'MERIT', 1), listRow('w1', 'WAITING', 2)],
      }),
    ),
    http.get('/api/v1/admission/intakes/r1/publish/estimate', ({ request }) => {
      state.estimateQueries.push(new URL(request.url).search);
      const refId = new URL(request.url).searchParams.get('ref_id') ?? '';
      return HttpResponse.json({
        recipients: 580,
        segments: 320,
        metered: true,
        available: over.available ?? 1000,
        already_published: (over.published ?? []).includes(refId),
      });
    }),
    http.post('/api/v1/admission/intakes/r1/publish', async ({ request }) => {
      state.posts += 1;
      state.keys.push(request.headers.get('Idempotency-Key'));
      state.bodies.push(await request.json());
      return HttpResponse.json({ sms_attempted: 580 });
    }),
    http.patch('/api/v1/admission-intakes/r1', async ({ request }) => {
      state.names = (
        (await request.json()) as { show_names_publicly: boolean }
      ).show_names_publicly;
      return HttpResponse.json({ id: 'r1' });
    }),
  );
  renderWithRouter(tree, {
    initialEntries: ['/rounds/r1'],
    tenantId: 'tenant-1',
    role: 'ADMIN',
    locale: 'en',
  });
  return state;
}

describe('PublicationPanel', () => {
  it('shows the estimate before sending, and a double click sends once', async () => {
    const state = setup();
    const user = userEvent.setup();
    const [publishButton] = await screen.findAllByRole('button', { name: 'Publish' });
    await waitFor(() => expect((publishButton as HTMLButtonElement).disabled).toBe(false));
    await user.click(publishButton!);
    const dialog = await screen.findByRole('alertdialog');
    expect(toLatinDigits(dialog.textContent ?? '')).toContain('580 SMS ≈ 320 credits');
    expect(state.posts).toBe(0);
    const confirm = Array.from(dialog.querySelectorAll('button')).find(
      (b) => b.textContent === 'Publish',
    )!;
    await user.dblClick(confirm);
    await waitFor(() => expect(state.posts).toBe(1));
    expect(state.keys[0]).toBeTruthy();
  });

  it('asks the estimate not to count rejected applicants by default', async () => {
    const state = setup();
    await screen.findAllByRole('button', { name: 'Publish' });
    await waitFor(() => expect(state.estimateQueries.length).toBeGreaterThan(0));
    expect(state.estimateQueries[0]).toContain('include_not_selected=false');
  });

  it('the names toggle shows the children warning', async () => {
    setup();
    const user = userEvent.setup();
    expect(screen.queryByRole('note')).toBeNull();
    await user.click(await screen.findByRole('switch', { name: 'List with names' }));
    expect((await screen.findByRole('note')).textContent).toContain("children's names");
  });

  it('shows stage, merit and waiting rows with their published state', async () => {
    setup({ published: ['m1'] });
    expect(await screen.findByRole('heading', { name: 'Written test' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Merit list' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: /Waiting list/ })).toBeTruthy();
    await waitFor(() => expect(screen.getAllByText('Published')).toHaveLength(1));
    expect(screen.getAllByText('Not published')).toHaveLength(2);
  });

  it('ticking include-not-selected on a stage row changes the estimate and the POST body', async () => {
    const state = setup();
    const user = userEvent.setup();
    const box = await screen.findByRole('checkbox', { name: /not selected/ });
    await user.click(box);
    await waitFor(() =>
      expect(state.estimateQueries.some((q) => q.includes('include_not_selected=true'))).toBe(true),
    );
    const [publishButton] = screen.getAllByRole('button', { name: 'Publish' });
    await waitFor(() => expect((publishButton as HTMLButtonElement).disabled).toBe(false));
    await user.click(publishButton!);
    const dialog = await screen.findByRole('alertdialog');
    await user.click(
      Array.from(dialog.querySelectorAll('button')).find((b) => b.textContent === 'Publish')!,
    );
    await waitFor(() => expect(state.posts).toBe(1));
    expect(state.bodies[0]).toMatchObject({
      what: 'STAGE',
      ref_id: 's1',
      send_sms: true,
      include_not_selected: true,
    });
  });

  it('blocks the send when the SMS needs more credits than are left', async () => {
    const state = setup({ available: 100 });
    const user = userEvent.setup();
    const [publishButton] = await screen.findAllByRole('button', { name: 'Publish' });
    await waitFor(() => expect((publishButton as HTMLButtonElement).disabled).toBe(false));
    await user.click(publishButton!);
    const dialog = await screen.findByRole('alertdialog');
    expect(dialog.textContent).toContain('Not enough credits');
    expect(
      Array.from(dialog.querySelectorAll('button')).some((b) => b.textContent === 'Publish'),
    ).toBe(false);
    expect(state.posts).toBe(0);
  });
});

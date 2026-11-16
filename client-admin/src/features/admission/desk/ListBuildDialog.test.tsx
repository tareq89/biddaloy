import { cleanupTestState, renderWithRouter, server } from '@biddaloy/ui/test';
import { createRootRoute, createRoute } from '@tanstack/react-router';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { afterEach, describe, expect, it } from 'vitest';

import { pickDate } from '../../../test/pick-date';

import { ListBuildDialog } from './ListBuildDialog';

afterEach(async () => {
  await cleanupTestState();
});

function setup(kind: 'MERIT' | 'WAITING', seatsLeft = 20) {
  const bodies: Record<string, unknown>[] = [];
  server.use(
    http.get('/api/v1/admission/applicants', () =>
      HttpResponse.json({
        data: [
          { id: 'a1', applicant_name: 'Rahim', status: 'PENDING' },
          { id: 'a2', applicant_name: 'Karim', status: 'SHORTLISTED' },
          { id: 'a3', applicant_name: 'Done', status: 'ADMITTED' },
        ],
        total: 3,
        page: 1,
        limit: 100,
        totalPages: 1,
      }),
    ),
    http.post('/api/v1/admission/intakes/r1/lists/:kind', async ({ request }) => {
      bodies.push((await request.json()) as Record<string, unknown>);
      return HttpResponse.json({ id: 'l1', affected: 3 });
    }),
  );
  const root = createRootRoute();
  const tree = root.addChildren([
    createRoute({
      getParentRoute: () => root,
      path: '/',
      component: () => (
        <ListBuildDialog
          roundId="r1"
          kind={kind}
          seatsLeft={seatsLeft}
          open
          onOpenChange={() => undefined}
        />
      ),
    }),
  ]);
  renderWithRouter(tree, {
    initialEntries: ['/'],
    tenantId: 'tenant-1',
    role: 'ADMIN',
    locale: 'en',
  });
  return bodies;
}

async function pickDeadline() {
  await screen.findByLabelText('Seats in this list');
  await pickDate(userEvent.setup(), 'Last date to take admission', '2026-12-15');
}

describe('ListBuildDialog', () => {
  it('refuses seats above the free seats', async () => {
    const bodies = setup('MERIT', 20);
    const cap = await screen.findByLabelText('Seats in this list');
    await userEvent.clear(cap);
    await userEvent.type(cap, '21');
    await userEvent.click(screen.getByRole('button', { name: 'Make list' }));
    expect((await screen.findByRole('alert')).textContent).toContain('from 1 to');
    expect(bodies).toHaveLength(0);
  });

  it('merit list posts seats and date only', async () => {
    const bodies = setup('MERIT', 20);
    await pickDeadline();
    await userEvent.click(screen.getByRole('button', { name: 'Make list' }));
    await waitFor(() => expect(bodies).toHaveLength(1));
    expect(Object.keys(bodies[0]!).sort()).toEqual(['act_by_date', 'capacity']);
    expect(bodies[0]!.capacity).toBe(20);
  });

  it.each([
    ['First come, first served', 'FIRST_COME'],
    ['Merit order', 'MERIT'],
  ])('waiting list "%s" posts order %s', async (label, order) => {
    const bodies = setup('WAITING');
    await pickDeadline();
    await userEvent.click(screen.getByRole('radio', { name: label }));
    await userEvent.click(screen.getByRole('button', { name: 'Make list' }));
    await waitFor(() => expect(bodies).toHaveLength(1));
    expect(bodies[0]!.order).toBe(order);
    expect(bodies[0]!.applicant_ids).toBeUndefined();
    expect(bodies[0]!.filter).toBeUndefined();
  });

  it('hand-picked posts the ids in the arranged order', async () => {
    const bodies = setup('WAITING');
    await pickDeadline();
    await userEvent.click(screen.getByRole('radio', { name: 'Pick by hand' }));
    await userEvent.click(await screen.findByRole('checkbox', { name: 'Add Rahim' }));
    await userEvent.click(screen.getByRole('checkbox', { name: 'Add Karim' }));
    expect(screen.queryByRole('checkbox', { name: 'Add Done' })).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Move Karim up' }));
    await userEvent.click(screen.getByRole('button', { name: 'Make list' }));
    await waitFor(() => expect(bodies).toHaveLength(1));
    expect(bodies[0]).toMatchObject({ order: 'MANUAL', applicant_ids: ['a2', 'a1'] });
  });

  it('filter posts quota, score and gender', async () => {
    const bodies = setup('WAITING');
    await pickDeadline();
    await userEvent.click(screen.getByRole('radio', { name: 'Filter' }));
    await userEvent.click(screen.getByRole('checkbox', { name: 'Teacher child' }));
    await userEvent.type(screen.getByLabelText('Lowest score'), '60.5');
    await userEvent.click(screen.getByRole('button', { name: 'Make list' }));
    await waitFor(() => expect(bodies).toHaveLength(1));
    expect(bodies[0]).toMatchObject({
      order: 'FILTER',
      filter: { quota_tags: ['quota_teacher_child'], min_score: 60.5 },
    });
  });
});

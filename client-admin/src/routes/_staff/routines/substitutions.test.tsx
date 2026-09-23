import { cleanupTestState, renderWithRouter, server } from '@biddaloy/ui/test';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { afterEach, describe, expect, it } from 'vitest';

import { routeTree } from '../../../routeTree.gen';

afterEach(async () => {
  await cleanupTestState();
});

// `substitute_teacher_id`/`covered_for_teacher_id`/`section_id` are all
// `z.string().uuid()` in the route's search schema (`.catch(undefined)`
// silently drops anything that fails validation) — real UUID-shaped ids
// here, not `"teacher-1"`, or a filter select never reaches the query.
const TEACHER_1_ID = '11111111-1111-4111-8111-111111111111';
const TEACHER_2_ID = '22222222-2222-4222-8222-222222222222';

function mockBaseData() {
  server.use(
    http.get('/api/v1/teachers', () =>
      HttpResponse.json({
        data: [
          { id: TEACHER_1_ID, user: { id: 'user-1', full_name: 'Ms Nahar' } },
          { id: TEACHER_2_ID, user: { id: 'user-2', full_name: 'Mr Karim' } },
        ],
        total: 2,
        page: 1,
        limit: 100,
        totalPages: 1,
      }),
    ),
    http.get('/api/v1/classes', () =>
      HttpResponse.json({ data: [], total: 0, page: 1, limit: 100, totalPages: 1 }),
    ),
  );
}

describe('/routines/substitutions', () => {
  it('lists substitutions and refetches when a filter changes', async () => {
    mockBaseData();
    let lastQuery: URLSearchParams | null = null;
    server.use(
      http.get('/api/v1/routines/substitutions', ({ request }) => {
        lastQuery = new URL(request.url).searchParams;
        return HttpResponse.json([
          {
            id: 'sub-1',
            routine_slot_id: 'slot-1',
            date: '2026-02-02',
            substitute_teacher_id: TEACHER_1_ID,
            is_cancelled: false,
            reason: 'Covering for a workshop',
            created_by: 'user-2',
            created_at: '2026-02-01T00:00:00Z',
            updated_at: '2026-02-01T00:00:00Z',
          },
        ]);
      }),
    );

    const { router } = renderWithRouter(routeTree, {
      initialEntries: ['/routines/substitutions'],
      tenantId: 'tenant-1',
      role: 'ADMIN',
      locale: 'en',
    });

    await waitFor(() => expect(screen.getByText('2026-02-02')).toBeTruthy());
    expect(screen.getByText('Covering for a workshop')).toBeTruthy();
    expect(screen.getByText(/Covered by Ms Nahar/)).toBeTruthy();

    const user = userEvent.setup();
    const coveringTeacherSelect = screen.getByLabelText(/covering teacher/i);
    await within(coveringTeacherSelect).findByRole('option', { name: 'Ms Nahar' });
    await user.selectOptions(coveringTeacherSelect, TEACHER_1_ID);

    await waitFor(() => expect(router.state.location.search).toMatchObject({
      substitute_teacher_id: TEACHER_1_ID,
    }));
    await waitFor(() =>
      expect(lastQuery?.get('substitute_teacher_id')).toBe(TEACHER_1_ID),
    );
  });

  it('opens the add-substitution dialog', async () => {
    mockBaseData();
    server.use(http.get('/api/v1/routines/substitutions', () => HttpResponse.json([])));

    renderWithRouter(routeTree, {
      initialEntries: ['/routines/substitutions'],
      tenantId: 'tenant-1',
      role: 'ADMIN',
      locale: 'en',
    });

    const user = userEvent.setup();
    await waitFor(() => expect(screen.getByText(/no substitutions/i)).toBeTruthy());
    const addButtons = screen.getAllByRole('button', { name: /add substitution/i });
    await user.click(addButtons[0]!);

    expect(screen.getByRole('dialog', { name: /record a substitution/i })).toBeTruthy();
  });
});

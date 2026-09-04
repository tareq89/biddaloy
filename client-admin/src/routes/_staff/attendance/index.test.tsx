import { cleanupTestState, renderWithRouter, server } from '@biddaloy/ui/test';
import { screen } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { afterEach, describe, expect, it } from 'vitest';

import { routeTree } from '../../../routeTree.gen';

describe('/attendance', () => {
  afterEach(async () => {
    await cleanupTestState();
  });

  it("lists every section the teacher is mapped to, with today's mark state", async () => {
    server.use(
      http.get('/api/v1/attendance/my-sections', () =>
        HttpResponse.json([
          {
            section_id: 'section-1',
            section_name: 'A',
            class_name: 'Class 5',
            student_count: 40,
            today: null,
          },
          {
            section_id: 'section-2',
            section_name: 'B',
            class_name: 'Class 6',
            student_count: 35,
            today: {
              state: 'FINALIZED',
              present: 30,
              absent: 3,
              late: 2,
              leave: 0,
              unmarked: 0,
              marked_at: '2026-09-04T00:00:00.000Z',
            },
          },
        ]),
      ),
    );

    renderWithRouter(routeTree, {
      initialEntries: ['/attendance'],
      tenantId: 'tenant-1',
      role: 'TEACHER',
      locale: 'en',
    });

    expect(await screen.findByText('Class 5 A')).toBeTruthy();
    expect(screen.getByText('Class 6 B')).toBeTruthy();
    expect(screen.getByText('Not marked')).toBeTruthy();
    expect(screen.getByText('Marked 32/35')).toBeTruthy();
  });

  it('shows an empty state when the teacher has no mapped sections', async () => {
    server.use(http.get('/api/v1/attendance/my-sections', () => HttpResponse.json([])));

    renderWithRouter(routeTree, {
      initialEntries: ['/attendance'],
      tenantId: 'tenant-1',
      role: 'TEACHER',
      locale: 'en',
    });

    expect(await screen.findByText('No sections assigned yet')).toBeTruthy();
  });
});

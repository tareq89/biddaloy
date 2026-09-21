/**
 * [20.3.1] scale editor route — save blocked while the server's preview
 * reports coverage problems, and proceeds to the recompute preview dialog
 * once the preview is valid. Same `renderWithRouter` + real route tree
 * pattern as `classes/$classId.test.tsx`.
 */
import { cleanupTestState, renderWithRouter, server } from '@biddaloy/ui/test';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { afterEach, describe, expect, it } from 'vitest';

import { routeTree } from '../../../routeTree.gen';

const SCALE = {
  id: 'scale-1',
  academic_year_id: 'ay-1',
  class_id: null,
  name: 'Class 6 Scale',
  revision: 1,
  bands: [
    {
      id: 'band-1',
      percent_from: 80,
      percent_to: 100,
      grade: 'A+',
      gpa: 5,
      is_fail: false,
      sequence: 1,
      comment: null,
    },
    {
      id: 'band-2',
      percent_from: 0,
      percent_to: 79,
      grade: 'F',
      gpa: 0,
      is_fail: true,
      sequence: 2,
      comment: null,
    },
  ],
};

describe('/grading-scales/$scaleId', () => {
  afterEach(async () => {
    await cleanupTestState();
  });

  it('save stays blocked and renders the server problem list while coverage is incomplete', async () => {
    server.use(
      http.get('/api/v1/grading/scales/:id', () => HttpResponse.json(SCALE)),
      http.post('/api/v1/grading/scales/:id/bands/preview', () =>
        HttpResponse.json({
          valid: false,
          problems: [{ type: 'GAP', message: 'Gap between 80% and 100%' }],
          bands_changed: true,
          affected_result_count: 0,
        }),
      ),
    );

    renderWithRouter(routeTree, {
      initialEntries: ['/grading-scales/scale-1'],
      tenantId: 'tenant-1',
      role: 'ADMIN',
      locale: 'en',
    });

    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Save' }));

    expect(await screen.findByText('Gap between 80% and 100%')).toBeTruthy();
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('save proceeds to the recompute preview dialog once the preview is valid', async () => {
    server.use(
      http.get('/api/v1/grading/scales/:id', () => HttpResponse.json(SCALE)),
      http.post('/api/v1/grading/scales/:id/bands/preview', () =>
        HttpResponse.json({
          valid: true,
          problems: [],
          bands_changed: true,
          affected_result_count: 3,
        }),
      ),
    );

    renderWithRouter(routeTree, {
      initialEntries: ['/grading-scales/scale-1'],
      tenantId: 'tenant-1',
      role: 'ADMIN',
      locale: 'en',
    });

    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Save' }));

    await waitFor(() => expect(screen.getByRole('dialog')).toBeTruthy());
    expect(
      screen.getByText("3 students' results will be recalculated against the new bands."),
    ).toBeTruthy();
  });
});

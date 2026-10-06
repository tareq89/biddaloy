/** [13.6.4] Summary: marks finished once, shows the four counts, next-step links. */
import '@biddaloy/ui/test';

import { cleanupTestState, renderWithRouter, server } from '@biddaloy/ui/test';
import { createRootRoute, createRoute } from '@tanstack/react-router';
import { screen, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { SummaryStep } from './summary-step';

function renderStep() {
  const root = createRootRoute();
  const welcome = createRoute({
    getParentRoute: () => root,
    path: '/welcome',
    component: SummaryStep,
  });
  return renderWithRouter(root.addChildren([welcome]), {
    initialEntries: ['/welcome?step=done'],
    locale: 'en',
    role: 'ADMIN',
    tenantId: 'school-1',
    accessToken: 'a.b.c',
  });
}

function mock(patch: (body: unknown) => void, patchStatus = 200) {
  server.use(
    http.get('/api/v1/onboarding/status', () =>
      HttpResponse.json({
        finished_at: null,
        dismissed_at: null,
        seen: true,
        setup_path: null,
        items: [],
        counts: { classes: 3, sections: 1, students: 12, staff: 4 },
        trial: null,
        support_url: null,
      }),
    ),
    http.patch('/api/v1/onboarding', async ({ request }) => {
      patch(await request.json());
      return patchStatus === 200
        ? HttpResponse.json({})
        : HttpResponse.json({ message: 'x' }, { status: patchStatus });
    }),
  );
}

afterEach(cleanupTestState);

describe('SummaryStep', () => {
  it('marks finished once and shows the counts', async () => {
    const patch = vi.fn();
    mock(patch);
    renderStep();
    expect(await screen.findByText('12 students')).toBeTruthy();
    expect(screen.getByText('3 classes')).toBeTruthy();
    expect(screen.getByText('1 section')).toBeTruthy();
    expect(screen.getByText('4 staff')).toBeTruthy();
    await waitFor(() => expect(patch).toHaveBeenCalledWith({ finished: true }));
    expect(patch).toHaveBeenCalledTimes(1);
  });

  it('links the three next steps', async () => {
    mock(vi.fn());
    renderStep();
    await screen.findByText('12 students');
    expect(screen.getAllByRole('link').map((a) => a.getAttribute('href'))).toEqual([
      '/fee-structures?from=welcome',
      '/guardians?invite=1&from=welcome',
      '/settings?section=communication&from=welcome',
    ]);
  });

  it('says so when finishing could not be saved', async () => {
    mock(vi.fn(), 500);
    renderStep();
    expect((await screen.findByRole('alert')).textContent).toMatch(/Could not mark setup/);
  });
});

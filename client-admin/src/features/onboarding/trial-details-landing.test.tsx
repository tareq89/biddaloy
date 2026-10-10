/** [67.2.04] `?trial=1` opens the trial details dialog for an ADMIN of a trial school. */
import '@biddaloy/ui/test';

import { cleanupTestState, renderWithRouter, server } from '@biddaloy/ui/test';
import { createRootRoute, createRoute } from '@tanstack/react-router';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { afterEach, describe, expect, it } from 'vitest';

import { TrialDetailsLanding } from './trial-details-landing';

function mockStatus(trial: object | null) {
  server.use(
    http.get('/api/v1/onboarding/status', () =>
      HttpResponse.json({
        finished_at: null,
        dismissed_at: null,
        seen: true,
        setup_path: null,
        items: [],
        counts: { classes: 0, sections: 0, students: 0, staff: 0 },
        trial,
        support_url: 'https://help.test/x',
      }),
    ),
  );
}

const TRIAL = { ends_at: '2026-12-01', days_left: 10, seats: { used: 12, limit: 50 } };

function renderLanding(role: string, entry = '/?trial=1') {
  const root = createRootRoute();
  const index = createRoute({
    getParentRoute: () => root,
    path: '/',
    component: TrialDetailsLanding,
  });
  return renderWithRouter(root.addChildren([index]), {
    locale: 'en',
    role,
    tenantId: 'school-1',
    accessToken: 'a.b.c',
    initialEntries: [entry],
  });
}

afterEach(cleanupTestState);

describe('TrialDetailsLanding', () => {
  it('opens for an ADMIN with a trial and clears ?trial on close', async () => {
    mockStatus(TRIAL);
    const { router } = renderLanding('ADMIN');
    expect(await screen.findByText('About your trial')).toBeTruthy();
    await userEvent.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByText('About your trial')).toBeNull());
    expect((router.state.location.search as Record<string, unknown>).trial).toBeUndefined();
  });

  it('renders nothing for a non-ADMIN, or without the flag', async () => {
    mockStatus(TRIAL);
    const teacher = renderLanding('TEACHER');
    await new Promise((r) => setTimeout(r, 50));
    expect(screen.queryByText('About your trial')).toBeNull();
    teacher.unmount();
    renderLanding('ADMIN', '/');
    await new Promise((r) => setTimeout(r, 50));
    expect(screen.queryByText('About your trial')).toBeNull();
  });

  it('does not fetch onboarding status on a page without ?trial=1', async () => {
    let calls = 0;
    server.use(
      http.get('/api/v1/onboarding/status', () => {
        calls += 1;
        return HttpResponse.json({});
      }),
    );
    renderLanding('ADMIN', '/');
    await new Promise((r) => setTimeout(r, 50));
    expect(calls).toBe(0);
  });
});

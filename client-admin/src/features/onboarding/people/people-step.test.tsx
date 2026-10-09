/** [13.6.4] People step: counts, `from=welcome` links, trial line, sample downloads. */
import '@biddaloy/ui/test';

import { cleanupTestState, renderWithRouter, server } from '@biddaloy/ui/test';
import { createRootRoute, createRoute } from '@tanstack/react-router';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { PeopleStep, type PeopleStepProps } from './people-step';

function mockStatus(over: object = {}) {
  server.use(
    http.get('/api/v1/onboarding/status', () =>
      HttpResponse.json({
        finished_at: null,
        dismissed_at: null,
        seen: true,
        setup_path: null,
        items: [],
        counts: { classes: 3, sections: 6, students: 12, staff: 4 },
        trial: null,
        support_url: null,
        ...over,
      }),
    ),
  );
}

function renderStep(props: PeopleStepProps = {}) {
  const root = createRootRoute();
  const welcome = createRoute({
    getParentRoute: () => root,
    path: '/welcome',
    component: () => <PeopleStep {...props} />,
  });
  return renderWithRouter(root.addChildren([welcome]), {
    initialEntries: ['/welcome?step=people'],
    locale: 'en',
    role: 'ADMIN',
    tenantId: 'school-1',
    accessToken: 'a.b.c',
  });
}

afterEach(cleanupTestState);

describe('PeopleStep', () => {
  it('shows the counts and links with from=welcome', async () => {
    mockStatus();
    renderStep();
    expect(await screen.findByText('12 students added')).toBeTruthy();
    expect(screen.getByText('4 staff added')).toBeTruthy();
    const hrefs = screen.getAllByRole('link').map((a) => a.getAttribute('href'));
    expect(hrefs).toEqual([
      '/students/new?from=welcome',
      '/students/import?from=welcome',
      '/staff?new=1&from=welcome',
      '/staff/import?from=welcome',
    ]);
    expect(screen.getByText(/People › Students and People › Staff/)).toBeTruthy();
  });

  it('shows the trial line only in a trial', async () => {
    mockStatus({
      trial: { ends_at: '2030-01-01', days_left: 5, seats: { used: 1, limit: 50 } },
    });
    renderStep();
    expect(await screen.findByText('Trial: you can add up to 50 students.')).toBeTruthy();
  });

  it('has no trial line outside a trial', async () => {
    mockStatus();
    renderStep();
    await screen.findByText('12 students added');
    expect(screen.queryByText(/Trial:/)).toBeNull();
  });

  it('calls the matching sample handler, hides the button without one', async () => {
    mockStatus();
    const students = vi.fn();
    renderStep({ onDownloadStudentSample: students });
    await userEvent.click(await screen.findByRole('button', { name: 'Download sample file' }));
    expect(students).toHaveBeenCalledOnce();
    expect(screen.getAllByRole('button', { name: 'Download sample file' })).toHaveLength(1);
  });
});

describe('PeopleStep staff link', () => {
  it('opens /staff with the search key the staff route honours', async () => {
    mockStatus();
    const { router } = renderStep();
    const links = await screen.findAllByRole('link');
    await userEvent.click(links[2]!);
    expect(router.state.location.pathname).toBe('/staff');
    expect(router.state.location.search).toMatchObject({ new: 1, from: 'welcome' });
  });
});

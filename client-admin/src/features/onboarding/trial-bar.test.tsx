/** [13.5.1] Trial bar: ADMIN only, trial only, danger in the last 3 days, dialog from the tap. */
import '@biddaloy/ui/test';

import { cleanupTestState, renderWithRouter, server } from '@biddaloy/ui/test';
import { createRootRoute, createRoute } from '@tanstack/react-router';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { afterEach, describe, expect, it } from 'vitest';

import { TrialBar } from './trial-bar';

function mockStatus(trial: object | null, support_url: string | null = 'https://help.test/x') {
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
        support_url,
      }),
    ),
  );
}

function renderBar(role: string) {
  const root = createRootRoute();
  const index = createRoute({ getParentRoute: () => root, path: '/', component: TrialBar });
  return renderWithRouter(root.addChildren([index]), {
    locale: 'en',
    role,
    tenantId: 'school-1',
    accessToken: 'a.b.c',
  });
}

const trial = (days_left: number, limit: number | null = 50) => ({
  ends_at: '2026-12-01',
  days_left,
  seats: { used: 12, limit },
});

afterEach(cleanupTestState);

describe('TrialBar', () => {
  it('shows days and students to an ADMIN, in the warning tone', async () => {
    mockStatus(trial(10));
    renderBar('ADMIN');
    expect(await screen.findByText('Trial: 10 days left · 12 of 50 students')).toBeTruthy();
    expect(screen.getByRole('status').getAttribute('data-tone')).toBe('warning');
  });

  it('uses the danger tone in the last 3 days', async () => {
    mockStatus(trial(3));
    renderBar('ADMIN');
    await screen.findByText(/3 days left/);
    expect(screen.getByRole('status').getAttribute('data-tone')).toBe('danger');
  });

  it('renders nothing for a TEACHER or a school without a trial', async () => {
    mockStatus(trial(10));
    const teacher = renderBar('TEACHER');
    await new Promise((r) => setTimeout(r, 50));
    expect(screen.queryByRole('status')).toBeNull();
    teacher.unmount();
    mockStatus(null);
    renderBar('ADMIN');
    await new Promise((r) => setTimeout(r, 50));
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('opens the details dialog from the one tap target, with a safe contact link', async () => {
    mockStatus(trial(10));
    renderBar('ADMIN');
    await userEvent.click(await screen.findByRole('button', { name: /Trial: 10 days left/ }));
    expect(await screen.findByText('About your trial')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Contact us' }).getAttribute('href')).toBe(
      'https://help.test/x',
    );
  });

  it('drops a javascript: support url', async () => {
    mockStatus(trial(10), 'javascript:alert(1)');
    renderBar('ADMIN');
    await userEvent.click(await screen.findByRole('button', { name: /Trial: 10 days left/ }));
    await screen.findByText('About your trial');
    expect(screen.queryByRole('link', { name: 'Contact us' })).toBeNull();
  });
});

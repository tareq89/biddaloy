import '@biddaloy/ui/test';

import { cleanupTestState, renderWithRouter, server } from '@biddaloy/ui/test';
import { createRootRoute, createRoute } from '@tanstack/react-router';
import { screen } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { afterEach, describe, expect, it } from 'vitest';

import Widget, { widgetKey } from './setup-checklist.widget';

const status = (over: object = {}) => ({
  finished_at: null,
  dismissed_at: null,
  seen: true,
  setup_path: null,
  items: [
    { id: 'profile', done: true },
    { id: 'structure', done: false },
  ],
  counts: { classes: 0, sections: 0, students: 0, staff: 1 },
  ...over,
});

function renderWidget(body: object, role = 'ADMIN', variant: 'full' | 'compact' = 'full') {
  server.use(http.get('/api/v1/onboarding/status', () => HttpResponse.json(body)));
  const root = createRootRoute();
  const index = createRoute({
    getParentRoute: () => root,
    path: '/',
    component: () => <Widget variant={variant} size="L" />,
  });
  return renderWithRouter(root.addChildren([index]), { role, tenantId: 'tenant-1', locale: 'en' });
}

const settle = () => new Promise((r) => setTimeout(r, 50));

describe('setup-checklist widget', () => {
  afterEach(cleanupTestState);

  it('exports its key', () => {
    expect(widgetKey).toBe('setup-checklist');
  });

  it.each(['full', 'compact'] as const)('%s: shows the card while unfinished', async (v) => {
    renderWidget(status(), 'ADMIN', v);
    expect(await screen.findByRole('heading', { level: 2 })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Hide' })).toBeTruthy();
  });

  it('renders nothing when hidden by the admin', async () => {
    renderWidget(status({ dismissed_at: '2026-10-01T00:00:00Z' }));
    await settle();
    expect(screen.queryByRole('heading')).toBeNull();
  });

  it('renders nothing when every item is done', async () => {
    renderWidget(status({ items: [{ id: 'profile', done: true }] }));
    await settle();
    expect(screen.queryByRole('heading')).toBeNull();
  });

  it('renders nothing for a TEACHER', async () => {
    renderWidget(status(), 'TEACHER');
    await settle();
    expect(screen.queryByRole('heading')).toBeNull();
  });
});

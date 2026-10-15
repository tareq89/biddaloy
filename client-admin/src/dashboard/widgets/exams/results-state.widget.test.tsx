import '@biddaloy/ui/test';

import { cleanupTestState, renderWithRouter, server } from '@biddaloy/ui/test';
import { createRootRoute, createRoute } from '@tanstack/react-router';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { afterEach, describe, expect, it } from 'vitest';

import Widget, { widgetKey } from './results-state.widget';

const URL = '/api/v1/dashboard/widgets/results-state';

const round = (draft: number, processed: number, published: number) => ({
  exam_name: 'Half Yearly',
  class_count: 3,
  draft,
  processed,
  published,
  last_published_at: null,
});

function renderWidget(variant: 'full' | 'compact' | 'tile', role = 'EXAM_CONTROLLER') {
  const root = createRootRoute();
  const index = createRoute({
    getParentRoute: () => root,
    path: '/',
    component: () => <Widget variant={variant} size="M" />,
  });
  return renderWithRouter(root.addChildren([index]), { locale: 'en', role, tenantId: 'tenant-1' });
}
const serve = (body: object) => server.use(http.get(URL, () => HttpResponse.json(body)));
const MIXED = { draft: 1, processed: 1, published: 3, rounds: [round(1, 1, 3)] };

describe('results-state widget', () => {
  afterEach(async () => {
    await cleanupTestState();
  });

  it('exports its key', () => {
    expect(widgetKey).toBe('results-state');
  });

  it('full: 3 of 5, waiting sentence, badges, link', async () => {
    serve(MIXED);
    renderWidget('full');
    expect(await screen.findByText('3 of 5')).toBeTruthy();
    expect(screen.getByText('1 exam is ready and waiting to be published.')).toBeTruthy();
    expect(screen.getByText('Half Yearly')).toBeTruthy();
    expect(screen.getByText('Published 3')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Open results' }).getAttribute('href')).toBe(
      '/results',
    );
  });

  it('all published: allPublished', async () => {
    serve({ draft: 0, processed: 0, published: 4, rounds: [round(0, 0, 4)] });
    renderWidget('full');
    expect(await screen.findByText('Every finished exam is published.')).toBeTruthy();
  });

  it('no link without RESULT_PROCESS (EXECUTIVE)', async () => {
    serve(MIXED);
    renderWidget('full', 'EXECUTIVE');
    await screen.findByText('3 of 5');
    expect(screen.queryByRole('link')).toBeNull();
  });

  it('tile: label, value, note', async () => {
    serve(MIXED);
    renderWidget('tile');
    expect(await screen.findByText('3 of 5')).toBeTruthy();
    expect(screen.getByText('Results published')).toBeTruthy();
    expect(screen.getByText('1 exam is ready and waiting to be published.')).toBeTruthy();
  });

  it('empty: reason, no link', async () => {
    serve({ draft: 0, processed: 0, published: 0, rounds: [] });
    renderWidget('full');
    expect(await screen.findByText('No exam this year yet.')).toBeTruthy();
    expect(screen.queryByRole('link')).toBeNull();
  });

  it('error: Retry refetches', async () => {
    let calls = 0;
    server.use(
      http.get(URL, () => {
        calls += 1;
        return HttpResponse.json({ statusCode: 500, message: 'x' }, { status: 500 });
      }),
    );
    renderWidget('full');
    await userEvent.click(await screen.findByRole('button', { name: 'Try again' }));
    await waitFor(() => expect(calls).toBeGreaterThanOrEqual(2));
  });

  it('is axe clean on full', async () => {
    serve(MIXED);
    const { container } = renderWidget('full');
    await screen.findByText('3 of 5');
    await expect(container).toHaveNoViolations();
  });
});

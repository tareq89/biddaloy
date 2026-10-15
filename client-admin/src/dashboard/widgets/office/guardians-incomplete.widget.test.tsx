import '@biddaloy/ui/test';

import { cleanupTestState, renderWithRouter, server } from '@biddaloy/ui/test';
import { createRootRoute, createRoute } from '@tanstack/react-router';
import { screen } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { afterEach, describe, expect, it } from 'vitest';

import Widget, { widgetKey } from './guardians-incomplete.widget';

const URL = '/api/v1/dashboard/widgets/guardians-incomplete';

function renderWidget(variant: 'full' | 'compact' | 'tile') {
  const root = createRootRoute();
  const index = createRoute({
    getParentRoute: () => root,
    path: '/',
    component: () => <Widget variant={variant} size="S" />,
  });
  return renderWithRouter(root.addChildren([index]), {
    locale: 'en',
    role: 'OFFICE_STAFF',
    tenantId: 'tenant-1',
  });
}
const serve = (body: object) => server.use(http.get(URL, () => HttpResponse.json(body)));

describe('guardians-incomplete widget', () => {
  afterEach(async () => {
    await cleanupTestState();
  });

  it('exports its key', () => {
    expect(widgetKey).toBe('guardians-incomplete');
  });

  it('full: value, sentence, link carries ?incomplete=1', async () => {
    serve({ incomplete_count: 23, total_count: 1410 });
    renderWidget('full');
    expect(await screen.findByText('23 incomplete')).toBeTruthy();
    expect(screen.getByText(/Out of 1,410 guardians/)).toBeTruthy();
    expect(screen.getByRole('link', { name: 'See who' }).getAttribute('href')).toBe(
      '/guardians?incomplete=1',
    );
  });

  it('zero: none sentence, link kept', async () => {
    serve({ incomplete_count: 0, total_count: 10 });
    renderWidget('full');
    expect(await screen.findByText('Every guardian record is complete.')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'See who' })).toBeTruthy();
  });

  it('tile: label and value', async () => {
    serve({ incomplete_count: 23, total_count: 1410 });
    renderWidget('tile');
    expect(await screen.findByText('23')).toBeTruthy();
    expect(screen.getByText('Guardian records to complete')).toBeTruthy();
  });

  it('is axe clean on full', async () => {
    serve({ incomplete_count: 23, total_count: 1410 });
    const { container } = renderWidget('full');
    await screen.findByText('23 incomplete');
    await expect(container).toHaveNoViolations();
  });
});

import '@biddaloy/ui/test';

import { cleanupTestState, renderWithRouter, server } from '@biddaloy/ui/test';
import { createRootRoute, createRoute } from '@tanstack/react-router';
import { screen } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { afterEach, describe, expect, it } from 'vitest';

import Widget, { widgetKey } from './students-added-today.widget';

const URL = '/api/v1/dashboard/widgets/students-added-today';

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
const serve = (added_today: number) =>
  server.use(http.get(URL, () => HttpResponse.json({ added_today, as_of: '2026-10-07' })));

describe('students-added-today widget', () => {
  afterEach(async () => {
    await cleanupTestState();
  });

  it('exports its key', () => {
    expect(widgetKey).toBe('students-added-today');
  });

  it('3 -> plural, link to /students', async () => {
    serve(3);
    renderWidget('full');
    expect(await screen.findByText('3 students')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Open students' }).getAttribute('href')).toBe(
      '/students',
    );
  });

  it('1 -> singular', async () => {
    serve(1);
    renderWidget('full');
    expect(await screen.findByText('1 student')).toBeTruthy();
  });

  it('0 -> none, link kept', async () => {
    serve(0);
    renderWidget('full');
    expect(await screen.findByText('No student added today.')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Open students' })).toBeTruthy();
  });

  it('tile: label and value', async () => {
    serve(3);
    renderWidget('tile');
    expect(await screen.findByText('3')).toBeTruthy();
    expect(screen.getByText('Students added today')).toBeTruthy();
  });

  it('is axe clean on full', async () => {
    serve(3);
    const { container } = renderWidget('full');
    await screen.findByText('3 students');
    await expect(container).toHaveNoViolations();
  });
});

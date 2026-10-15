import '@biddaloy/ui/test';

import { cleanupTestState, renderWithRouter, server } from '@biddaloy/ui/test';
import { createRootRoute, createRoute } from '@tanstack/react-router';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { afterEach, describe, expect, it } from 'vitest';

import Widget, { widgetKey } from './admissions-today.widget';

const URL = '/api/v1/dashboard/widgets/admissions-today';

const BASE = {
  new_today: 4,
  pending_total: 17,
  latest: [
    {
      id: 'a-1',
      reference_number: 'ADM-2026-0042',
      applicant_name: 'Nadia Akter',
      created_at: '2026-10-07T03:12:00.000Z',
      status: 'PENDING',
    },
  ],
};

function renderWidget(variant: 'full' | 'compact' | 'tile', locale: 'en' | 'bn' = 'en') {
  const root = createRootRoute();
  const index = createRoute({
    getParentRoute: () => root,
    path: '/',
    component: () => <Widget variant={variant} size="S" />,
  });
  return renderWithRouter(root.addChildren([index]), {
    locale,
    role: 'OFFICE_STAFF',
    tenantId: 'tenant-1',
  });
}
const serve = (body: object) => server.use(http.get(URL, () => HttpResponse.json(body)));

describe('admissions-today widget', () => {
  afterEach(async () => {
    await cleanupTestState();
  });

  it('exports its key', () => {
    expect(widgetKey).toBe('admissions-today');
  });

  it('full: value, pending sentence, row, link', async () => {
    serve(BASE);
    renderWidget('full');
    expect(await screen.findByText('4 new')).toBeTruthy();
    expect(screen.getByText('17 waiting for review')).toBeTruthy();
    expect(screen.getByText('Nadia Akter')).toBeTruthy();
    expect(screen.getByText('Waiting')).toBeTruthy();
    expect(screen.queryByText('PENDING')).toBeNull();
    expect(screen.getByRole('link', { name: 'Open applicants' }).getAttribute('href')).toBe(
      '/admissions/applicants',
    );
  });

  it('bn: reference number stays Latin', async () => {
    serve(BASE);
    renderWidget('full', 'bn');
    expect(await screen.findByText('ADM-2026-0042')).toBeTruthy();
  });

  it('zero: none sentence, link kept', async () => {
    serve({ new_today: 0, pending_total: 0, latest: [] });
    renderWidget('full');
    expect(await screen.findByText('No new application today.')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Open applicants' })).toBeTruthy();
  });

  it('tile: label, value, note', async () => {
    serve(BASE);
    renderWidget('tile');
    expect(await screen.findByText('4')).toBeTruthy();
    expect(screen.getByText('New applications today')).toBeTruthy();
    expect(screen.getByText('17 waiting for review')).toBeTruthy();
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
    serve(BASE);
    const { container } = renderWidget('full');
    await screen.findByText('Nadia Akter');
    await expect(container).toHaveNoViolations();
  });
});

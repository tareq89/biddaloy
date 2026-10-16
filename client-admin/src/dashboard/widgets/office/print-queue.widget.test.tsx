import '@biddaloy/ui/test';

import { cleanupTestState, renderWithRouter, server } from '@biddaloy/ui/test';
import { createRootRoute, createRoute } from '@tanstack/react-router';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { afterEach, describe, expect, it } from 'vitest';

import Widget, { widgetKey } from './print-queue.widget';

const URL = '/api/v1/dashboard/widgets/print-queue';

const BASE = {
  total: 46,
  by_kind: [
    { kind: 'EXAM_ADMIT_CARD', count: 40 },
    { kind: 'STUDENT_ID_CARD', count: 6 },
  ],
};

function renderWidget(variant: 'full' | 'compact', locale: 'en' | 'bn' = 'en') {
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

describe('print-queue widget', () => {
  afterEach(async () => {
    await cleanupTestState();
  });

  it('exports its key', () => {
    expect(widgetKey).toBe('print-queue');
  });

  it('full: total, translated kind labels (never the raw enum), link to the to-print tab', async () => {
    serve(BASE);
    renderWidget('full');
    expect(await screen.findByText('46 waiting to print')).toBeTruthy();
    expect(screen.getByText('Admit card')).toBeTruthy();
    expect(screen.getByText('Student ID card')).toBeTruthy();
    expect(screen.queryByText('EXAM_ADMIT_CARD')).toBeNull();
    const link = screen.getByRole('link', { name: 'Open the print queue' });
    expect(link.getAttribute('href')).toContain('tab=to-print');
  });

  it('compact: shows the total (the card drops the footer at this size)', async () => {
    serve(BASE);
    renderWidget('compact');
    expect(await screen.findByText('46 waiting to print')).toBeTruthy();
  });

  it('bn: Bengali strings and digits', async () => {
    serve(BASE);
    renderWidget('full', 'bn');
    expect(await screen.findByText('৪৬টা প্রিন্ট করা বাকি')).toBeTruthy();
  });

  it('zero: nothing-to-print sentence, no kind rows', async () => {
    serve({ total: 0, by_kind: [] });
    renderWidget('full');
    expect(await screen.findByText('Nothing to print.')).toBeTruthy();
    expect(screen.queryByText('Admit card')).toBeNull();
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
    await screen.findByText('46 waiting to print');
    await expect(container).toHaveNoViolations();
  });
});

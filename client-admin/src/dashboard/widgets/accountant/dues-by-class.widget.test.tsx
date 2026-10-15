import '@biddaloy/ui/test';

import { cleanupTestState, renderWithRouter, server } from '@biddaloy/ui/test';
import { createRootRoute, createRoute } from '@tanstack/react-router';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { afterEach, describe, expect, it } from 'vitest';

import Widget, { widgetKey } from './dues-by-class.widget';

const URL = '/api/v1/dashboard/widgets/dues-by-class';

const AMOUNTS = [120000, 90000, 70000, 50000, 30000, 20000, 6000];
const BASE = {
  total_due: 386000,
  classes: AMOUNTS.map((amount, i) => ({
    class_id: `00000000-0000-4000-8000-00000000000${i}`,
    class_name: `Class ${10 - i}`,
    amount,
    student_count: 20 - i,
  })),
};

function renderWidget(variant: 'full' | 'compact' | 'tile', locale = 'en') {
  const root = createRootRoute();
  const index = createRoute({
    getParentRoute: () => root,
    path: '/',
    component: () => <Widget variant={variant} size="M" />,
  });
  return renderWithRouter(root.addChildren([index]), {
    locale,
    role: 'ACCOUNTANT',
    tenantId: 'tenant-1',
  });
}
const serve = (body: object) => server.use(http.get(URL, () => HttpResponse.json(body)));

describe('dues-by-class widget', () => {
  afterEach(async () => {
    await cleanupTestState();
  });

  it('exports its key', () => {
    expect(widgetKey).toBe('dues-by-class');
  });

  it('full: 7 classes -> 5 bars, share sentence, link carries the top class_id', async () => {
    serve(BASE);
    renderWidget('full');
    expect(await screen.findByText('31% of all dues is in class Class 10 alone.')).toBeTruthy();
    expect(screen.getAllByRole('progressbar')).toHaveLength(5);
    const link = screen.getByRole('link', { name: "See class Class 10's dues" });
    expect(link.getAttribute('href')).toBe(
      '/fees/dues?class_id=00000000-0000-4000-8000-000000000000',
    );
  });

  it('first bar is the brand colour, the rest neutral', async () => {
    serve(BASE);
    renderWidget('full');
    await screen.findByText(/of all dues is in class/);
    const fills = screen.getAllByTestId('bar-fill').map((f) => f.className);
    expect(fills[0]).toContain('bg-primary');
    expect(fills.slice(1).every((c) => c.includes('bg-muted-foreground'))).toBe(true);
  });

  it('table lists all 7 classes with student counts', async () => {
    serve(BASE);
    renderWidget('full');
    await screen.findByText(/of all dues is in class/);
    await userEvent.click(screen.getByRole('button', { name: 'Show table' }));
    expect(screen.getAllByRole('row')).toHaveLength(8);
    expect(screen.getByText('Class 4')).toBeTruthy();
  });

  it('compact: top class amount and sentence', async () => {
    serve(BASE);
    renderWidget('compact');
    expect(await screen.findByText('৳1,20,000.00')).toBeTruthy();
    expect(screen.getByText('31% of all dues is in class Class 10 alone.')).toBeTruthy();
  });

  it('empty', async () => {
    serve({ total_due: 0, classes: [] });
    renderWidget('full');
    expect(await screen.findByText('No class has dues.')).toBeTruthy();
  });

  it('error: Retry is offered', async () => {
    server.use(http.get(URL, () => HttpResponse.json({ message: 'x' }, { status: 404 })));
    renderWidget('full');
    expect(await screen.findByRole('button', { name: 'Try again' })).toBeTruthy();
  });
});

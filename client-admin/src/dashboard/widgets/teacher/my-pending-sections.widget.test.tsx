import '@biddaloy/ui/test';

import { cleanupTestState, renderWithRouter, server } from '@biddaloy/ui/test';
import { createRootRoute, createRoute } from '@tanstack/react-router';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { afterEach, describe, expect, it } from 'vitest';

import Widget, { widgetKey } from './my-pending-sections.widget';

const URL = '/api/v1/dashboard/widgets/my-pending-sections';

const sec = (id: string, section_name: string, taken: boolean) => ({
  section_id: id,
  class_name: '7',
  section_name,
  student_count: 40,
  taken,
  unmarked: taken ? 0 : 40,
});
const BASE = {
  date: '2026-10-07',
  is_working_day: true,
  pending_count: 1,
  sections: [sec('s-b', 'B', false), sec('s-a', 'A', true), sec('s-c', 'C', true)],
};

function renderWidget(variant: 'full' | 'compact' | 'tile') {
  const root = createRootRoute();
  const index = createRoute({
    getParentRoute: () => root,
    path: '/',
    component: () => <Widget variant={variant} size="M" />,
  });
  return renderWithRouter(root.addChildren([index]), {
    locale: 'en',
    role: 'TEACHER',
    tenantId: 'tenant-1',
  });
}
const serve = (body: object) => server.use(http.get(URL, () => HttpResponse.json(body)));

describe('my-pending-sections widget', () => {
  afterEach(async () => {
    await cleanupTestState();
  });

  it('exports its key', () => {
    expect(widgetKey).toBe('my-pending-sections');
  });

  it('full: one primary button to the first pending section, badges per row', async () => {
    serve(BASE);
    renderWidget('full');
    const button = await screen.findByRole('link', { name: 'Take attendance for 7 B' });
    expect(button.getAttribute('href')).toMatch(/^\/attendance\/s-b\?date=2026-10-07$/);
    expect(screen.getAllByRole('link')).toHaveLength(1);
    expect(screen.getByText('Pending')).toBeTruthy();
    expect(screen.getAllByText('Taken')).toHaveLength(2);
    expect(screen.getByText("Today's attendance for 7 B is not taken yet.")).toBeTruthy();
  });

  it('nothing pending: allTaken and no button', async () => {
    serve({
      ...BASE,
      pending_count: 0,
      sections: BASE.sections.map((s) => ({ ...s, taken: true })),
    });
    renderWidget('full');
    expect(await screen.findByText("Today's attendance is taken everywhere.")).toBeTruthy();
    expect(screen.queryByRole('link')).toBeNull();
  });

  it('closed day: no button', async () => {
    serve({ ...BASE, is_working_day: false, pending_count: 0, sections: [] });
    renderWidget('full');
    expect(await screen.findByText('No school today.')).toBeTruthy();
    expect(screen.queryByRole('link')).toBeNull();
  });

  it('compact: sentence in the header', async () => {
    serve(BASE);
    renderWidget('compact');
    expect(await screen.findByText("Today's attendance for 7 B is not taken yet.")).toBeTruthy();
  });

  it('tile: count and section hint', async () => {
    serve(BASE);
    renderWidget('tile');
    expect(await screen.findByText('1')).toBeTruthy();
    expect(screen.getByText('Attendance pending')).toBeTruthy();
    expect(screen.getByText('7 B pending')).toBeTruthy();
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
});

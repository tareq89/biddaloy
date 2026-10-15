import '@biddaloy/ui/test';

import { cleanupTestState, renderWithRouter, server } from '@biddaloy/ui/test';
import { createRootRoute, createRoute } from '@tanstack/react-router';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import Widget, { widgetKey } from './my-routine-today.widget';

const URL = '/api/v1/dashboard/widgets/my-routine-today';

const period = (starts_at: string, ends_at: string, extra: object = {}) => ({
  starts_at,
  ends_at,
  section_id: 's1',
  class_name: '7th',
  section_name: 'B',
  subject_name_en: 'Mathematics',
  subject_name_bn: 'গণিত',
  room_label: 'Main 202',
  is_homeroom: false,
  covering: false,
  cancelled: false,
  ...extra,
});
const BASE = {
  date: '2026-10-07',
  is_working_day: true,
  periods: [
    period('08:00', '08:40'),
    period('09:00', '09:40'),
    period('10:30', '11:10', { is_homeroom: true }),
    period('11:20', '12:00', { cancelled: true }),
    period('12:10', '12:50', { covering: true }),
  ],
  next_day: null,
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
    role: 'TEACHER',
    tenantId: 'tenant-1',
  });
}
const serve = (body: object) => server.use(http.get(URL, () => HttpResponse.json(body)));

describe('my-routine-today widget', () => {
  beforeEach(() => {
    // 10:10 in Dhaka (UTC+6)
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-07T04:10:00Z'));
  });
  afterEach(async () => {
    vi.useRealTimers();
    await cleanupTestState();
  });

  it('exports its key', () => {
    expect(widgetKey).toBe('my-routine-today');
  });

  it('full: next period, own-section note, now divider, badges, link', async () => {
    serve(BASE);
    renderWidget('full');
    expect(
      await screen.findByText(/Next period in 20 min, Main 202 — your own section 7th B\./),
    ).toBeTruthy();
    expect(screen.getByText('Now 10:10 AM')).toBeTruthy();
    expect(screen.getByText('Next')).toBeTruthy();
    expect(screen.getByText('Cancelled')).toBeTruthy();
    expect(screen.getByText('Covering')).toBeTruthy();
    expect(screen.getByText('10:30 AM – 11:10 AM')).toBeTruthy();
    expect(screen.getByRole('link', { name: "Whole week's routine" }).getAttribute('href')).toBe(
      '/routines/my',
    );
  });

  it('bn: Bangla digits and subject name', async () => {
    serve(BASE);
    renderWidget('full', 'bn');
    expect((await screen.findAllByText(/গণিত/)).length).toBeGreaterThan(0);
    expect(screen.getByText('৫')).toBeTruthy();
  });

  it('compact: count and done sentence', async () => {
    serve(BASE);
    renderWidget('compact');
    expect(await screen.findByText('5')).toBeTruthy();
    expect(screen.getByText(/periods today, 2 done/)).toBeTruthy();
  });

  it('shows the next day line when nothing is left today', async () => {
    serve({
      ...BASE,
      periods: [period('08:00', '08:40')],
      next_day: {
        date: '2026-10-08',
        starts_at: '08:00',
        class_name: '6th',
        section_name: 'A',
        subject_name_en: 'English',
        subject_name_bn: null,
      },
    });
    renderWidget('full');
    expect(await screen.findByText(/First period on .*8th October, 2026.*6th A/)).toBeTruthy();
  });

  it('a cancelled period running now is not "Now"', async () => {
    serve({ ...BASE, periods: [period('10:00', '10:40', { cancelled: true })] });
    renderWidget('full');
    expect(await screen.findByText('Cancelled')).toBeTruthy();
    expect(screen.queryByText('Now')).toBeNull();
  });

  it('empty: reason and outline link', async () => {
    serve({ ...BASE, periods: [] });
    renderWidget('full');
    expect(await screen.findByText('No periods for you today.')).toBeTruthy();
    expect(screen.getByRole('link', { name: "Whole week's routine" }).getAttribute('href')).toBe(
      '/routines/my',
    );
  });

  it('closed day', async () => {
    serve({ ...BASE, is_working_day: false, periods: [] });
    renderWidget('full');
    expect(await screen.findByText('No school today.')).toBeTruthy();
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

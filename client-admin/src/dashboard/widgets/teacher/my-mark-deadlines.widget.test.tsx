import '@biddaloy/ui/test';

import { cleanupTestState, renderWithRouter, server } from '@biddaloy/ui/test';
import { createRootRoute, createRoute } from '@tanstack/react-router';
import { screen } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import Widget, { widgetKey } from './my-mark-deadlines.widget';

const URL = '/api/v1/dashboard/widgets/my-mark-deadlines';

const item = (extra: object = {}) => ({
  exam_id: 'e1',
  exam_name: 'Half-yearly',
  section_id: 's1',
  class_name: '7',
  section_name: 'A',
  subject_id: 'sub1',
  subject_name_en: 'Mathematics',
  subject_name_bn: 'গণিত',
  entered: 32,
  expected: 40,
  state: 'DRAFT',
  mark_entry_deadline: null,
  last_sitting_date: null,
  ...extra,
});
const body = (...items: object[]) => ({ outstanding_students: 8, items });

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
const serve = (b: object) => server.use(http.get(URL, () => HttpResponse.json(b)));

describe('my-mark-deadlines widget', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-07T04:10:00Z')); // 7 Oct in Dhaka
  });
  afterEach(async () => {
    vi.useRealTimers();
    await cleanupTestState();
  });

  it('exports its key', () => {
    expect(widgetKey).toBe('my-mark-deadlines');
  });

  it('deadline in 3 days', async () => {
    serve(body(item({ mark_entry_deadline: '2026-10-10' })));
    renderWidget('full');
    expect(
      await screen.findByText(/Deadline in 3 days, .*10th October, 2026 — 7 A Mathematics left\./),
    ).toBeTruthy();
  });

  it('deadline today', async () => {
    serve(body(item({ mark_entry_deadline: '2026-10-07' })));
    renderWidget('full');
    expect(await screen.findByText('Deadline today — 7 A Mathematics left.')).toBeTruthy();
  });

  it('deadline passed 2 days ago', async () => {
    serve(body(item({ mark_entry_deadline: '2026-10-05' })));
    renderWidget('full');
    expect(
      await screen.findByText('Deadline passed 2 days ago — 7 A Mathematics left.'),
    ).toBeTruthy();
  });

  it('no deadline: ended 3 days ago from the last sitting', async () => {
    serve(body(item({ last_sitting_date: '2026-10-04' })));
    renderWidget('full');
    expect(
      await screen.findByText('Half-yearly ended 3 days ago — 7 A Mathematics left.'),
    ).toBeTruthy();
  });

  it('neither date: noDate', async () => {
    serve(body(item()));
    renderWidget('full');
    expect(await screen.findByText('7 A Mathematics left.')).toBeTruthy();
  });

  it('full: meter 32/40, link to the first not-submitted item, submitted badge', async () => {
    serve(
      body(item({ state: 'SUBMITTED', entered: 40 }), item({ exam_id: 'e2', section_id: 's2' })),
    );
    renderWidget('full');
    expect(await screen.findByText('Submitted')).toBeTruthy();
    expect(screen.getByText('32 / 40')).toBeTruthy();
    expect(
      screen.getByRole('link', { name: 'Enter marks for 7 A Mathematics' }).getAttribute('href'),
    ).toBe('/marks/e2/s2/sub1');
  });

  it('tile: percentage of the first item', async () => {
    serve(body(item()));
    renderWidget('tile');
    expect(await screen.findByText('80%')).toBeTruthy();
    expect(screen.getByRole('meter')).toBeTruthy();
  });

  it('compact: outstanding students', async () => {
    serve(body(item()));
    renderWidget('compact');
    expect(await screen.findByText('8')).toBeTruthy();
    expect(screen.getByText('Mark entry, 7 A')).toBeTruthy();
  });

  it('empty: reason and /marks link', async () => {
    serve({ outstanding_students: 0, items: [] });
    renderWidget('full');
    expect(await screen.findByText('No mark entry waiting for you.')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Mark deadlines' }).getAttribute('href')).toBe(
      '/marks',
    );
  });
});

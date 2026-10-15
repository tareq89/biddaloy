import '@biddaloy/ui/test';

import { cleanupTestState, renderWithRouter, server } from '@biddaloy/ui/test';
import { createRootRoute, createRoute } from '@tanstack/react-router';
import { screen } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { afterEach, describe, expect, it } from 'vitest';

import Widget, { widgetKey } from './my-syllabus-progress.widget';

const URL = '/api/v1/dashboard/widgets/my-syllabus-progress';

const item = (id: string, className: string, en: string, bn: string | null, done: number) => ({
  class_id: `c-${id}`,
  class_name: className,
  sections: [{ section_id: `s-${id}`, section_name: 'A' }],
  subject_id: `sub-${id}`,
  subject_name_en: en,
  subject_name_bn: bn,
  done,
  total: 100,
  percentage: done,
});

const BASE = {
  items: [
    item('1', '6', 'Math', 'গণিত', 80),
    item('2', '7', 'Science', 'বিজ্ঞান', 30),
    item('3', '8', 'English', null, 60),
    item('4', '9', 'History', 'ইতিহাস', 90),
    item('5', '10', 'Physics', 'পদার্থ', 50),
  ],
};

function renderWidget(variant: 'full' | 'compact', locale = 'en') {
  const root = createRootRoute();
  const index = createRoute({
    getParentRoute: () => root,
    path: '/',
    component: () => <Widget variant={variant} size="M" />,
  });
  return renderWithRouter(root.addChildren([index]), {
    locale,
    role: 'EXECUTIVE',
    tenantId: 'tenant-1',
  });
}
const serve = (body: object) => server.use(http.get(URL, () => HttpResponse.json(body)));

describe('my-syllabus-progress widget', () => {
  afterEach(async () => {
    await cleanupTestState();
  });

  it('widgetKey', () => {
    expect(widgetKey).toBe('my-syllabus-progress');
  });

  it('full: 5 bars lowest first, only lowest highlighted, noPace, no target, link', async () => {
    serve(BASE);
    renderWidget('full');
    expect(await screen.findByText('62%')).toBeTruthy();
    expect(screen.getByText(/7 A Science has covered the least \(30%\)/)).toBeTruthy();
    const bars = screen.getAllByRole('progressbar');
    expect(bars).toHaveLength(5);
    expect(screen.getByText('7 A Science', { selector: 'span,div,p' })).toBeTruthy();
    expect(screen.queryByTestId('bar-target')).toBeNull();
    expect(screen.getByText('Comparison with the plan comes with study plans.')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Open syllabus' }).getAttribute('href')).toBe(
      '/academics/syllabus',
    );
  });

  it('compact: average and least covered, no bars', async () => {
    serve(BASE);
    renderWidget('compact');
    expect(await screen.findByText('62%')).toBeTruthy();
    expect(screen.getByText(/has covered the least/)).toBeTruthy();
    expect(screen.queryAllByRole('progressbar')).toHaveLength(0);
  });

  it('bn: Bangla subject name and digits', async () => {
    serve(BASE);
    renderWidget('full', 'bn');
    expect(await screen.findByText('৬২%')).toBeTruthy();
    expect(screen.getAllByText(/বিজ্ঞান/).length).toBeGreaterThan(0);
  });

  it('with a plan: marker at the expected %, gap note on the behind subject, behind sentence', async () => {
    serve({
      behind_count: 1,
      items: [
        { ...item('1', '6', 'Math', 'গণিত', 80), expected_percentage: 70 },
        { ...item('2', '7', 'Science', 'বিজ্ঞান', 30), expected_percentage: 47 },
      ],
    });
    renderWidget('full');
    // mean of 70 and 47 = 59 (rounded)
    expect(await screen.findByText('Expected by today: 59%')).toBeTruthy();
    expect(screen.getByText('17% behind')).toBeTruthy();
    expect(screen.getByText('1 subject is behind the plan.')).toBeTruthy();
    expect(screen.queryByText('Comparison with the plan comes with study plans.')).toBeNull();
  });

  it('with a plan and nobody behind: on-pace line', async () => {
    serve({
      behind_count: 0,
      items: [{ ...item('1', '6', 'Math', 'গণিত', 80), expected_percentage: 70 }],
    });
    renderWidget('full');
    expect(await screen.findByText('No subject is behind the plan.')).toBeTruthy();
    expect(screen.queryByText(/behind$/)).toBeNull();
  });

  it('empty', async () => {
    serve({ items: [] });
    renderWidget('full');
    expect(await screen.findByText('No syllabus topics in your subjects yet.')).toBeTruthy();
  });
});

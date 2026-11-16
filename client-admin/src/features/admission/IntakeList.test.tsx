import { cleanupTestState, renderWithRouter, server } from '@biddaloy/ui/test';
import { createRootRoute } from '@tanstack/react-router';
import { screen } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { afterEach, describe, expect, it } from 'vitest';

import { IntakeList } from './IntakeList';

afterEach(async () => {
  await cleanupTestState();
});

const tree = createRootRoute({ component: IntakeList });
const render = (locale: 'bn' | 'en' = 'bn') =>
  renderWithRouter(tree, { initialEntries: ['/'], tenantId: 'tenant-1', role: 'ADMIN', locale });

const site = (has_published: boolean) =>
  http.get('/api/v1/website', () => HttpResponse.json({ has_published, subdomain: 'demo' }));

describe('IntakeList', () => {
  it('empty state says there is no round yet', async () => {
    server.use(
      http.get('/api/v1/admission-intakes', () => HttpResponse.json([])),
      site(true),
    );
    render();
    expect(await screen.findByText('এখনও কোনো ভর্তি রাউন্ড নেই')).toBeTruthy();
  });

  it('with no published site the copy button becomes the publish-site link', async () => {
    server.use(
      http.get('/api/v1/admission-intakes', () => HttpResponse.json([])),
      site(false),
    );
    render();
    const link = await screen.findByText('ফর্ম চালু করতে স্কুলের সাইট প্রকাশ করুন');
    expect(link.closest('a')?.getAttribute('href')).toBe('/website');
    expect(screen.queryByText('ফর্মের লিংক কপি করুন')).toBeNull();
  });

  it('with a published site the copy-link button shows and rows open the desk', async () => {
    server.use(
      http.get('/api/v1/admission-intakes', () =>
        HttpResponse.json([
          {
            id: 'r1',
            title: 'Class 1 admission',
            class_name: 'One',
            section_name: null,
            template_key: 'WRITTEN',
            seat_count: 60,
            open_date: '2027-01-01',
            close_date: '2027-01-31',
            status: 'OPEN',
          },
        ]),
      ),
      site(true),
    );
    render();
    expect(await screen.findByText('Class 1 admission')).toBeTruthy();
    expect(screen.getByText('লিখিত পরীক্ষা')).toBeTruthy();
    expect(await screen.findByText('ফর্মের লিংক কপি করুন')).toBeTruthy();
    expect(
      screen.getAllByRole('link').some((a) => a.getAttribute('href') === '/admissions/rounds/r1'),
    ).toBe(true);
  });
});

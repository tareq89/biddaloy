import { cleanupTestState, renderWithRouter, server } from '@biddaloy/ui/test';
import { screen, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { afterEach, describe, expect, it } from 'vitest';

import { routeTree } from '../../../routeTree.gen';

const S1 = {
  section_id: 'section-1',
  section_name: 'A',
  class_id: 'class-7',
  class_name: 'Class 7',
  assignment_type: 'CLASS_TEACHER',
};
const S2 = {
  section_id: 'section-2',
  section_name: 'B',
  class_id: 'class-6',
  class_name: 'Class 6',
  assignment_type: 'ASSISTANT_CLASS_TEACHER',
};

function mockSections(rows: unknown[]) {
  server.use(http.get('/api/v1/my-class/sections', () => HttpResponse.json(rows)));
}

function render(entry: string) {
  return renderWithRouter(routeTree, {
    initialEntries: [entry],
    tenantId: 'tenant-1',
    role: 'TEACHER',
    locale: 'en',
  });
}

describe('/my-class', () => {
  afterEach(async () => {
    await cleanupTestState();
  });

  it('shows the empty state when the teacher has no homeroom section', async () => {
    mockSections([]);
    render('/my-class');
    expect(await screen.findByText('No section yet')).toBeTruthy();
    expect(screen.getByRole('heading', { level: 1, name: 'My class' })).toBeTruthy();
    expect(
      screen.getByText('You are not a class teacher of any section yet — ask an admin.'),
    ).toBeTruthy();
  });

  it('redirects to the section page when there is exactly one section', async () => {
    mockSections([S1]);
    const { router } = render('/my-class');
    await waitFor(() => expect(router.state.location.pathname).toBe('/my-class/section-1'));
  });

  it('redirects to the attendance register with ?then=attendance', async () => {
    mockSections([S1]);
    const { router } = render('/my-class?then=attendance');
    await waitFor(() => expect(router.state.location.pathname).toBe('/attendance/section-1'));
  });

  it('lists two sections as link cards with the role as plain text', async () => {
    mockSections([S1, S2]);
    render('/my-class');
    const first = await screen.findByRole('link', { name: /^Class 7 – A\s*Class teacher$/ });
    const second = screen.getByRole('link', {
      name: /^Class 6 – B\s*Assistant class teacher$/,
    });
    expect(first.getAttribute('href')).toBe('/my-class/section-1');
    expect(second.getAttribute('href')).toBe('/my-class/section-2');
    expect(screen.getByRole('heading', { level: 1, name: 'My class' })).toBeTruthy();
    expect(screen.getByText('Pick a section to open.')).toBeTruthy();
  });

  it('offers a retry when the sections request fails', async () => {
    server.use(http.get('/api/v1/my-class/sections', () => HttpResponse.json({}, { status: 500 })));
    render('/my-class');
    // 5xx is retried twice with backoff (~3s) before the error state shows.
    expect(
      await screen.findByRole('button', { name: 'Try again' }, { timeout: 8000 }),
    ).toBeTruthy();
    expect(screen.getByRole('heading', { level: 1, name: 'My class' })).toBeTruthy();
    expect(screen.getByText('Could not load your sections.')).toBeTruthy();
  }, 15_000);
});

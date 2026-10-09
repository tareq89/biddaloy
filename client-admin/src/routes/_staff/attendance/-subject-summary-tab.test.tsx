import { cleanupTestState, renderWithRouter, server } from '@biddaloy/ui/test';
import { screen } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { afterEach, describe, expect, it } from 'vitest';

import { routeTree } from '../../../routeTree.gen';

/** Real route tree (same as reports.test.tsx); the tab is `?view=subjects`. */
describe('reports "By subject" tab', () => {
  afterEach(async () => {
    await cleanupTestState();
  });

  function mock(body: Record<string, unknown>) {
    server.use(
      http.get('/api/v1/schools/:id/settings', () =>
        HttpResponse.json({
          version: 1,
          attendance: { periodAttendance: { enabled: true }, lowAttendanceThresholdPercent: 75 },
        }),
      ),
      http.get('/api/v1/attendance/sections/:sectionId/subject-summary', () =>
        HttpResponse.json(body),
      ),
    );
  }
  const counts = (attended: number, percentage: number | null) => ({
    present: attended,
    late: 0,
    absent: 0,
    leave: 0,
    attended,
    percentage,
  });
  const open = (section = '&section_id=section-1') =>
    renderWithRouter(routeTree, {
      initialEntries: [`/attendance/reports?view=subjects${section}`],
      tenantId: 'tenant-1',
      role: 'ADMIN',
      locale: 'en',
    });

  it('renders a column per subject with held, the cell, the percentage, em dash and low tone', async () => {
    mock({
      subjects: [
        { subject_id: 's1', name: 'Bangla', held: 8 },
        { subject_id: 's2', name: 'Math', held: 0 },
      ],
      rows: [
        {
          student_id: 'st-1',
          roll_number: 3,
          full_name: 'Karim Rahman',
          by_subject: { s1: counts(4, 50), s2: counts(0, null) },
        },
      ],
    });
    open();
    await screen.findByText('Karim Rahman');
    expect(screen.getByRole('columnheader', { name: /Bangla \(\S*8\)/ })).toBeTruthy();
    expect(screen.getByRole('columnheader', { name: /Math/ })).toBeTruthy();
    expect(screen.getByText(/^\S*4\/\S*8$/)).toBeTruthy();
    expect(screen.getByText(/^\S*50%$/)).toBeTruthy();
    expect(screen.getByText('Low')).toBeTruthy();
    expect(screen.getAllByText('—').length).toBeGreaterThan(0);
    expect(screen.getByRole('link', { name: 'View' }).getAttribute('href')).toBe('/students/st-1');
  });

  it('shows the empty state when no subject has period attendance', async () => {
    mock({ subjects: [], rows: [] });
    open();
    expect(
      await screen.findByRole('heading', { name: 'No period attendance this month' }),
    ).toBeTruthy();
  });

  it('asks for a section when none is picked', async () => {
    mock({ subjects: [], rows: [] });
    open('');
    expect(await screen.findByRole('heading', { name: 'Pick a section' })).toBeTruthy();
  });
});

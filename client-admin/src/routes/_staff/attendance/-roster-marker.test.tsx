import { cleanupTestState, renderWithProviders, server } from '@biddaloy/ui/test';
import { screen, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { RosterMarker, useArrivalBells } from './-roster-marker';

const STUDENTS = [
  { student_id: 'st-1', full_name: 'Rahim Uddin', roll_number: 1 },
  { student_id: 'st-2', full_name: 'Karim Ali', roll_number: 2 },
] as never;

const base = {
  students: STUDENTS,
  draft: {},
  onStatusChange: vi.fn(),
  onMinutesLateChange: vi.fn(),
  onAllPresent: vi.fn(),
  onSubmit: vi.fn(),
};

const LABEL = 'Guardian waits for the arrival notice';

/** The register page's wiring: the hook feeds the bell set into one RosterMarker. */
function WithBells({ enabled }: { enabled: boolean }) {
  const subscribed = useArrivalBells('section-1', enabled);
  return <RosterMarker {...base} arrivalSubscribed={subscribed} />;
}

describe('RosterMarker arrival bell', () => {
  afterEach(async () => {
    vi.restoreAllMocks();
    await cleanupTestState();
  });

  it('shows the bell only for students in the subscribed set', async () => {
    renderWithProviders(<RosterMarker {...base} arrivalSubscribed={new Set(['st-1'])} />, {
      tenantId: 'tenant-1',
      locale: 'en',
    });
    expect(await screen.findAllByLabelText(LABEL)).toHaveLength(1);
    const row = screen.getByText('Rahim Uddin').closest('li');
    expect(row?.querySelector(`[aria-label="${LABEL}"]`)).toBeTruthy();
    expect(
      screen.getByText('Karim Ali').closest('li')?.querySelector(`[aria-label="${LABEL}"]`),
    ).toBeNull();
  });

  it('renders no bell and makes no request when the prop is absent', async () => {
    const hit = vi.fn();
    server.use(
      http.get('/api/v1/attendance/arrival-subscriptions', () => {
        hit();
        return HttpResponse.json([]);
      }),
    );
    renderWithProviders(<WithBells enabled={false} />, { tenantId: 'tenant-1', locale: 'en' });
    await screen.findByText('Rahim Uddin');
    expect(screen.queryByLabelText(LABEL)).toBeNull();
    expect(hit).not.toHaveBeenCalled();
  });

  it('fetches ACTIVE subscriptions for the section and bells those students', async () => {
    let query = '';
    server.use(
      http.get('/api/v1/attendance/arrival-subscriptions', ({ request }) => {
        query = new URL(request.url).search;
        return HttpResponse.json([{ student_id: 'st-2', status: 'ACTIVE' }]);
      }),
    );
    renderWithProviders(<WithBells enabled />, { tenantId: 'tenant-1', locale: 'en' });
    await waitFor(() => expect(screen.getAllByLabelText(LABEL)).toHaveLength(1));
    expect(query).toContain('sectionId=section-1');
    expect(query).toContain('status=ACTIVE');
    expect(
      screen.getByText('Karim Ali').closest('li')?.querySelector(`[aria-label="${LABEL}"]`),
    ).toBeTruthy();
  });
});

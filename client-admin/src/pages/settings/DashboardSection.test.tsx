import '@biddaloy/ui/test';

import { cleanupTestState, renderWithProviders, server } from '@biddaloy/ui/test';
import { screen, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { DashboardSection } from './DashboardSection';
import { WithTestRouter } from './with-test-router';

const SCHOOL_ID = 'school-1';
const opts = { locale: 'en' as const, role: 'ADMIN' as const, tenantId: SCHOOL_ID };
const STORED = {
  risk: { absentStreakDays: 5, monthlyAttendancePct: 60, failedSubjects: 2, overdueDays: 90 },
  committeeAttendanceTargetPct: 85,
  digestTime: '06:45',
};
const LABELS = {
  streak: 'Absent in a row (days)',
  pct: 'Attendance in the last 30 days below (%)',
  failed: 'Failed subjects in the latest published exam (at least)',
  overdue: 'Oldest unpaid bill older than (days)',
  target: 'Attendance target (%)',
};

function value(el: HTMLElement) {
  return (el as HTMLInputElement).value;
}

function mount(dashboard?: typeof STORED) {
  const patchBody = vi.fn();
  server.use(
    http.patch('/api/v1/schools/:id/settings', async ({ request }) => {
      patchBody(await request.json());
      return HttpResponse.json({ version: 1 });
    }),
  );
  const view = renderWithProviders(
    <WithTestRouter>
      <DashboardSection schoolId={SCHOOL_ID} dashboard={dashboard} />
    </WithTestRouter>,
    opts,
  );
  return { patchBody, ...view };
}

describe('DashboardSection', () => {
  afterEach(async () => {
    await cleanupTestState();
  });

  it('shows stored values', async () => {
    mount(STORED);
    expect(value(await screen.findByLabelText(LABELS.streak))).toBe('5');
    expect(value(screen.getByLabelText(LABELS.pct))).toBe('60');
    expect(value(screen.getByLabelText(LABELS.failed))).toBe('2');
    expect(value(screen.getByLabelText(LABELS.overdue))).toBe('90');
    expect(value(screen.getByLabelText(LABELS.target))).toBe('85');
    expect(screen.getByText('The at-risk list updates a few minutes after you save.')).toBeTruthy();
  });

  it('shows the defaults when nothing is stored', async () => {
    mount();
    expect(value(await screen.findByLabelText(LABELS.streak))).toBe('3');
    expect(value(screen.getByLabelText(LABELS.pct))).toBe('75');
    expect(value(screen.getByLabelText(LABELS.failed))).toBe('1');
    expect(value(screen.getByLabelText(LABELS.overdue))).toBe('60');
    expect(value(screen.getByLabelText(LABELS.target))).toBe('90');
  });

  it('saves exactly the dashboard slice', async () => {
    const { patchBody, user } = mount(STORED);
    const field = await screen.findByLabelText(LABELS.streak);
    await user.clear(field);
    await user.type(field, '7');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(patchBody).toHaveBeenCalled());
    expect(patchBody.mock.calls[0]![0]).toEqual({
      version: 1,
      dashboard: { ...STORED, risk: { ...STORED.risk, absentStreakDays: 7 } },
    });
  });

  it.each([
    ['streak', '0'],
    ['streak', '31'],
    ['pct', '101'],
    ['overdue', '366'],
  ] as const)('rejects %s = %s and sends nothing', async (key, bad) => {
    const { patchBody, user } = mount(STORED);
    const field = await screen.findByLabelText(LABELS[key]);
    await user.clear(field);
    await user.type(field, bad);
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByText(/Enter a whole number from/)).toBeTruthy();
    expect(patchBody).not.toHaveBeenCalled();
  });

  it('shows a translated error when the server rejects the save', async () => {
    server.use(
      http.patch('/api/v1/schools/:id/settings', () =>
        HttpResponse.json(
          { statusCode: 400, message: 'SERVER_TEXT', timestamp: '', path: '', requestId: 'r' },
          { status: 400 },
        ),
      ),
    );
    const { user } = renderWithProviders(
      <WithTestRouter>
        <DashboardSection schoolId={SCHOOL_ID} dashboard={STORED} />
      </WithTestRouter>,
      opts,
    );
    await user.click(await screen.findByRole('button', { name: 'Save' }));
    expect((await screen.findByRole('alert')).textContent).toBe("Couldn't save. Try again.");
  });
});

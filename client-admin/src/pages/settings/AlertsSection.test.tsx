import '@biddaloy/ui/test';

import { cleanupTestState, renderWithProviders, server } from '@biddaloy/ui/test';
import { screen, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { AlertsSection } from './AlertsSection';
import { WithTestRouter } from './with-test-router';

const SCHOOL_ID = 'school-1';
const opts = { locale: 'en' as const, role: 'ADMIN' as const, tenantId: SCHOOL_ID };

const attention = {
  rules: {},
  attendanceGraceMinutes: 15,
  classStartingLeadMinutes: 10,
  dailyAt: '07:00',
  eveningAt: '17:00',
  quietHours: { start: '21:00', end: '07:00' },
  guardianSmsFallback: false,
  guardianSmsDailyCap: 2,
  smsCreditLowThreshold: 200,
  failedMessagesThreshold: 10,
  escalateAttendanceToHeads: true,
};

function renderSection(
  over: Partial<typeof attention> & { rules?: Record<string, { enabled: boolean }> } = {},
) {
  return renderWithProviders(
    <WithTestRouter>
      <AlertsSection schoolId={SCHOOL_ID} attention={{ ...attention, ...over }} />
    </WithTestRouter>,
    opts,
  );
}

function capturePatch() {
  const body = vi.fn();
  server.use(
    http.patch('/api/v1/schools/:id/settings', async ({ request }) => {
      body(await request.json());
      return HttpResponse.json({ version: 1 });
    }),
  );
  return body;
}

describe('AlertsSection', () => {
  afterEach(async () => {
    await cleanupTestState();
  });

  it('groups rules by role in order and locks the urgent ones', async () => {
    renderSection();
    const headings = (await screen.findAllByRole('heading', { level: 3 })).map(
      (h) => h.textContent,
    );
    expect(headings.indexOf('Admin')).toBeGreaterThanOrEqual(0);
    expect(headings.indexOf('Admin')).toBeLessThan(headings.indexOf('Teacher'));
    expect(headings.indexOf('Teacher')).toBeLessThan(headings.indexOf('Everyone'));

    const locked = screen.getAllByRole<HTMLButtonElement>('switch').filter((s) => s.disabled);
    expect(locked.length).toBeGreaterThan(0);
    for (const s of locked) expect(s.getAttribute('aria-checked')).toBe('true');
    expect(screen.getAllByText("Can't be switched off").length).toBeGreaterThan(0);
  });

  it('renders a disabled rule unchecked, and saves a toggled rule without any locked key', async () => {
    const body = capturePatch();
    const { user } = renderSection({ rules: { 'homework.due_today': { enabled: false } } });

    const off = await screen.findByRole('switch', { name: 'Homework due today' });
    expect(off.getAttribute('aria-checked')).toBe('false');

    await user.click(screen.getByRole('switch', { name: 'Homework to mark' }));
    await user.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(body).toHaveBeenCalled());
    const sent = body.mock.calls[0]![0].attention.rules as Record<string, { enabled: boolean }>;
    expect(sent['homework.due_today']).toEqual({ enabled: false });
    expect(sent['attendance.not_taken']).toBeUndefined();
    expect(sent['system.backup_failed']).toBeUndefined();
    expect(Object.values(sent).filter((r) => !r.enabled)).toHaveLength(2);
  });

  it('rejects an out-of-range grace time and sends nothing', async () => {
    const body = capturePatch();
    const { user } = renderSection();
    const grace = await screen.findByLabelText('Grace time after the first period starts');
    await user.clear(grace);
    await user.type(grace, '121');
    await user.click(screen.getByRole('button', { name: 'Save' }));

    expect(await screen.findByText('Enter a whole number from 0 to 120')).toBeTruthy();
    expect(body).not.toHaveBeenCalled();
  });

  it('shows the daily SMS cap only when the fallback is on', async () => {
    const { user } = renderSection();
    const toggle = await screen.findByRole('switch', {
      name: "Send an SMS when the app can't reach a guardian",
    });
    expect(screen.queryByLabelText('Most SMS per guardian per day')).toBeNull();
    await user.click(toggle);
    expect(await screen.findByLabelText('Most SMS per guardian per day')).toBeTruthy();
  });

  it('saves quiet hours as { start, end }', async () => {
    const body = capturePatch();
    const { user } = renderSection({ guardianSmsFallback: true });
    await screen.findByRole('group', { name: 'Quiet hours for push messages' });
    await user.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(body).toHaveBeenCalled());
    const sent = body.mock.calls[0]![0].attention;
    expect(sent.quietHours).toEqual({ start: '21:00', end: '07:00' });
    expect(sent.guardianSmsFallback).toBe(true);
    expect(sent.attendanceGraceMinutes).toBe(15);
  });

  it('has no accessibility violations', async () => {
    const { container } = renderSection();
    await screen.findByRole('group', { name: 'Quiet hours for push messages' });
    await expect(container).toHaveNoViolations();
  });
});

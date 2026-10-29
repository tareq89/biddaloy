import {
  apiErrorBody,
  cleanupTestState,
  guardianFactory,
  renderWithRouter,
  server,
  studentFactory,
} from '@biddaloy/ui/test';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { afterEach, describe, expect, it } from 'vitest';

import { routeTree } from '../../../../routeTree.gen';

/** The Guardians tab, mounted through the real `/students/$studentId` route. */
describe('students/-detail/guardians-tab', () => {
  afterEach(async () => {
    await cleanupTestState();
  });

  function renderGuardians(role = 'ADMIN', subs: unknown[] = [], listStatus = 200) {
    const primary = guardianFactory({
      id: 'g-primary',
      full_name: 'Karim Uddin',
      relationship: 'Father',
      phone: '+8801711000004',
      is_primary_contact: true,
    });
    const other = guardianFactory({
      id: 'g-other',
      full_name: 'Salma Begum',
      relationship: 'Family friend',
      phone: null,
      is_primary_contact: false,
    });
    const student = studentFactory({ id: 'student-1', guardians: [other, primary] });
    server.use(
      http.get('/api/v1/students/:id', () => HttpResponse.json(student)),
      http.get('/api/v1/students/:studentId/promotion-overrides', () => HttpResponse.json([])),
      http.get('/api/v1/attendance/arrival-subscriptions', () =>
        listStatus === 200
          ? HttpResponse.json(subs)
          : HttpResponse.json(
              apiErrorBody(listStatus, 'no', '/api/v1/attendance/arrival-subscriptions'),
              { status: listStatus },
            ),
      ),
    );
    return renderWithRouter(routeTree, {
      initialEntries: ['/students/student-1?tab=guardians'],
      tenantId: 'tenant-1',
      role,
      locale: 'en',
    });
  }

  it('lists the primary guardian first, translates known relationships and links to the guardian', async () => {
    renderGuardians();

    const table = await screen
      .findByRole('region', { name: 'Guardians of Rahim Uddin' })
      .catch(() => screen.findByRole('region', { name: /^Guardians of / }));
    const rows = within(table).getAllByRole('row');
    expect(rows[1]?.textContent).toContain('Karim Uddin');
    expect(rows[1]?.textContent).toContain('Primary contact');
    expect(within(table).getByText('Father')).toBeTruthy();
    // Free text that is not a known value is shown as typed.
    expect(within(table).getByText('Family friend')).toBeTruthy();
    // Phones are formatted, never the raw international form.
    expect(within(table).queryByText('+8801711000004')).toBeNull();
    expect(within(table).getByRole('link', { name: 'View Karim Uddin' }).getAttribute('href')).toBe(
      '/guardians/g-primary',
    );
  });

  it('shows the edit hint only with STUDENT_UPDATE', async () => {
    const admin = renderGuardians('ADMIN');
    expect(await screen.findByRole('link', { name: 'edit the student' })).toBeTruthy();
    admin.unmount();

    renderGuardians('TEACHER');
    await screen.findByRole('region', { name: /^Guardians of / });
    expect(screen.queryByRole('link', { name: 'edit the student' })).toBeNull();
  });

  describe('arrival notice', () => {
    const sub = (lock: 'NONE' | 'NEVER', over: Record<string, unknown> = {}) => ({
      id: 'sub-1',
      student_id: 'student-1',
      guardian_id: 'g-primary',
      student_name: 'Rahim',
      guardian_name: 'Karim Uddin',
      status: 'ACTIVE',
      mode: 'RECURRING',
      channel: 'PUSH',
      lock,
      consumed_at: null,
      updated_at: '2026-10-20T08:00:00.000Z',
      ...over,
    });

    async function openMenu() {
      const user = userEvent.setup();
      await user.click(
        await screen.findByRole('button', { name: 'Arrival notice for Karim Uddin' }),
      );
      return user;
    }

    it('gives a TEACHER the manage items and no lock items', async () => {
      renderGuardians('TEACHER', [sub('NONE')]);
      await openMenu();
      expect(await screen.findByRole('menuitem', { name: 'Every day' })).toBeTruthy();
      expect(screen.getByRole('menuitem', { name: 'Stop' })).toBeTruthy();
      expect(screen.queryByRole('menuitem', { name: 'Always' })).toBeNull();
      expect(screen.queryByRole('menuitem', { name: 'Never' })).toBeNull();
      expect(screen.queryByRole('menuitem', { name: 'Let the teacher decide' })).toBeNull();
    });

    it('gives an admin the lock items', async () => {
      renderGuardians('ADMIN', [sub('NONE')]);
      await openMenu();
      expect(await screen.findByRole('menuitem', { name: 'Always' })).toBeTruthy();
      expect(screen.getByRole('menuitem', { name: 'Never' })).toBeTruthy();
      expect(screen.getByRole('menuitem', { name: 'Let the teacher decide' })).toBeTruthy();
    });

    it('disables the manage items and says why when the row is locked', async () => {
      renderGuardians('TEACHER', [sub('NEVER')]);
      expect(await screen.findByText('Set by admin: never')).toBeTruthy();
      await openMenu();
      for (const name of ['Once', 'Every day', 'Stop']) {
        const item = await screen.findByRole('menuitem', { name });
        expect(
          item.getAttribute('aria-disabled') ?? item.getAttribute('data-disabled'),
        ).not.toBeNull();
      }
      // The reason sits beside the badge, not inside role="menu" where readers skip it.
      const note = screen.getByText('An admin has fixed this. It cannot be changed here.');
      expect(note.closest('[role="menu"]')).toBeNull();
    });

    it('shows Done for a used "Once" (OFF with consumed_at), not Stopped', async () => {
      renderGuardians('TEACHER', [
        sub('NONE', { status: 'OFF', mode: 'ONCE', consumed_at: '2026-10-20T02:20:00.000Z' }),
      ]);
      expect(await screen.findByText('Done')).toBeTruthy();
      expect(screen.queryByText('Stopped')).toBeNull();
    });

    it("hides the column when the list answers 404 (not this section's class teacher)", async () => {
      renderGuardians('TEACHER', [], 404);
      const table = await screen.findByRole('region', { name: /^Guardians of / });
      await within(table).findByText('Father');
      // The probe settles, then the column goes: no "Not asked", no menu that would 404 again.
      await waitFor(() =>
        expect(within(table).queryByRole('columnheader', { name: 'Arrival notice' })).toBeNull(),
      );
      expect(screen.queryByText('Not asked')).toBeNull();
      expect(screen.queryByRole('button', { name: 'Arrival notice for Karim Uddin' })).toBeNull();
    });

    it('shows a dash and no menu when the list fails, never "Not asked"', async () => {
      renderGuardians('TEACHER', [], 403);
      const table = await screen.findByRole('region', { name: /^Guardians of / });
      const headers = await within(table).findAllByRole('columnheader');
      const col = headers.findIndex((h) => h.textContent === 'Arrival notice');
      expect(col).toBeGreaterThanOrEqual(0);
      const karim = within(table)
        .getAllByRole('row')
        .find((r) => r.textContent?.includes('Karim Uddin'))!;
      await within(within(karim).getAllByRole('cell')[col]!).findByText('—');
      expect(screen.queryByText('Not asked')).toBeNull();
      expect(screen.queryByRole('button', { name: 'Arrival notice for Karim Uddin' })).toBeNull();
    });

    it('shows the last change date', async () => {
      renderGuardians('TEACHER', [sub('NONE')]);
      expect(await screen.findByText(/^Changed on /)).toBeTruthy();
    });
  });
});

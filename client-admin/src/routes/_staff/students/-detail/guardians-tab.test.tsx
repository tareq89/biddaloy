import {
  cleanupTestState,
  guardianFactory,
  renderWithRouter,
  server,
  studentFactory,
} from '@biddaloy/ui/test';
import { screen, within } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { afterEach, describe, expect, it } from 'vitest';

import { routeTree } from '../../../../routeTree.gen';

/** The Guardians tab, mounted through the real `/students/$studentId` route. */
describe('students/-detail/guardians-tab', () => {
  afterEach(async () => {
    await cleanupTestState();
  });

  function renderGuardians(role = 'ADMIN') {
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
});

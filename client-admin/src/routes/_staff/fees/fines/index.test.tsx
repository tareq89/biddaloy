/**
 * [38.4.3] `/fees/fines` — real `ListShell`/`DataTable` against the real
 * route tree, same reasoning `fee-structures/index.test.tsx`'s own header
 * comment gives for that page.
 */
import {
  cleanupTestState,
  classFactory,
  fineFactory,
  renderWithRouter,
  server,
  studentFactory,
} from '@biddaloy/ui/test';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { afterEach, describe, expect, it } from 'vitest';

import { routeTree } from '../../../../routeTree.gen';

const KLASS = classFactory({ id: 'class-9', name: 'Class 9' });
const STUDENT = studentFactory({ id: 'student-1', full_name: 'Karim Rahman' });

function referenceHandlers() {
  return [
    http.get('/api/v1/classes', () =>
      HttpResponse.json({ data: [KLASS], total: 1, page: 1, limit: 100, totalPages: 1 }),
    ),
    http.get('/api/v1/fee-structures', () =>
      HttpResponse.json({ data: [], total: 0, page: 1, limit: 100, totalPages: 1 }),
    ),
  ];
}

function finesHandler(items: ReturnType<typeof fineFactory>[]) {
  const charged = items.reduce((sum, fine) => sum + fine.total_amount, 0);
  const collected = items.reduce((sum, fine) => sum + fine.paid_amount, 0);
  const waived = items
    .filter((fine) => fine.status === 'WAIVED')
    .reduce((sum, fine) => sum + fine.total_amount, 0);
  return http.get('/api/v1/fees/fines', () =>
    HttpResponse.json({
      items,
      total: items.length,
      totals: { charged, collected, waived, outstanding: charged - collected - waived },
    }),
  );
}

function render(role: 'ADMIN' | 'ACCOUNTANT' | 'EXECUTIVE' = 'ADMIN', entry = '/fees/fines') {
  return renderWithRouter(routeTree, {
    initialEntries: [entry],
    tenantId: 'tenant-1',
    role,
    locale: 'en',
  });
}

describe('/fees/fines', () => {
  afterEach(async () => {
    await cleanupTestState();
  });

  it('renders fine rows and the totals footer', async () => {
    const fine = fineFactory({
      id: 'fine-1',
      student_name: STUDENT.full_name,
      student_id: STUDENT.id,
      total_amount: 100,
      paid_amount: 40,
    });
    server.use(finesHandler([fine]), ...referenceHandlers());

    render();

    await screen.findByRole('heading', { name: 'Fines' });
    expect(await screen.findByText('Karim Rahman')).toBeTruthy();
    expect(screen.getByText('Charged')).toBeTruthy();
    expect(screen.getByText('Collected')).toBeTruthy();
  });

  it('updates the URL when the status filter changes', async () => {
    const fine = fineFactory({
      id: 'fine-1',
      student_id: STUDENT.id,
      student_name: STUDENT.full_name,
    });
    server.use(finesHandler([fine]), ...referenceHandlers());

    const { router } = render();
    const user = userEvent.setup();
    await screen.findByRole('heading', { name: 'Fines' });

    await user.click(screen.getByRole('combobox', { name: 'Status' }));
    await user.click(await screen.findByRole('option', { name: 'Waived' }));

    await waitFor(() => expect(router.state.location.search).toMatchObject({ status: 'WAIVED' }));
  });

  it('shows an empty state with both CTAs when there are no fines', async () => {
    server.use(finesHandler([]), ...referenceHandlers());

    render();

    expect(await screen.findByText('No fines yet')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Log fine' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Generate fines' })).toBeTruthy();
  });

  it('hides Log fine / Generate fines for an EXECUTIVE (no FEE_GENERATE)', async () => {
    const fine = fineFactory({
      id: 'fine-1',
      student_id: STUDENT.id,
      student_name: STUDENT.full_name,
    });
    server.use(finesHandler([fine]), ...referenceHandlers());

    render('EXECUTIVE');

    await screen.findByRole('heading', { name: 'Fines' });
    // Logging a fine needs FEE_GENERATE too, so both entry points are gone.
    expect(screen.queryByRole('button', { name: 'Log fine' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Generate fines' })).toBeNull();
  });

  it('shows the Waive row action to an ADMIN but not to an ACCOUNTANT (no FEE_APPROVE)', async () => {
    const fine = fineFactory({
      id: 'fine-1',
      student_id: STUDENT.id,
      student_name: STUDENT.full_name,
    });
    server.use(finesHandler([fine]), ...referenceHandlers());

    const admin = render('ADMIN');
    expect((await screen.findAllByRole('button', { name: 'Waive fine' })).length).toBeGreaterThan(
      0,
    );
    admin.unmount();

    render('ACCOUNTANT');
    await screen.findByRole('heading', { name: 'Fines' });
    await screen.findAllByText('Karim Rahman');
    expect(screen.queryByRole('button', { name: 'Waive fine' })).toBeNull();
  });

  it('is axe clean', async () => {
    const fine = fineFactory({
      id: 'fine-1',
      student_id: STUDENT.id,
      student_name: STUDENT.full_name,
    });
    server.use(finesHandler([fine]), ...referenceHandlers());

    const { container } = render();

    await screen.findByText('Karim Rahman');
    await expect(container).toHaveNoViolations();
  });
});

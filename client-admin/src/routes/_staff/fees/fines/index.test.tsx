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
import { screen, waitFor, within } from '@testing-library/react';
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
    expect(screen.getByText('Every fine, logged by hand or made from a rule')).toBeTruthy();
    // Totals sit in a Card above the table.
    const totals = screen.getByRole('region', { name: 'Totals for this list' });
    expect(within(totals).getByText('Charged')).toBeTruthy();
    expect(within(totals).getByText('Collected')).toBeTruthy();
    expect(within(totals).getByText('Waived')).toBeTruthy();
    expect(within(totals).getByText('Outstanding')).toBeTruthy();
    expect(
      totals.compareDocumentPosition(screen.getByRole('table')) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it('labels every filter and reads month names, not 01-12', async () => {
    server.use(finesHandler([]), ...referenceHandlers());
    render();
    const user = userEvent.setup();
    await screen.findByRole('heading', { name: 'Fines' });

    expect(screen.getByRole('combobox', { name: 'Fine type' })).toBeTruthy();
    expect(screen.getByRole('combobox', { name: 'Source' })).toBeTruthy();
    await user.click(screen.getByRole('combobox', { name: 'Month' }));
    expect(await screen.findByRole('option', { name: /^(January|জানুয়ারি)$/ })).toBeTruthy();
  });

  it('requests 25 rows by default', async () => {
    let limit: string | null = null;
    server.use(
      http.get('/api/v1/fees/fines', ({ request }) => {
        limit = new URL(request.url).searchParams.get('limit');
        return HttpResponse.json({
          items: [],
          total: 0,
          totals: { charged: 0, collected: 0, waived: 0, outstanding: 0 },
        });
      }),
      ...referenceHandlers(),
    );
    render();
    await screen.findByRole('heading', { name: 'Fines' });
    await waitFor(() => expect(limit).toBe('25'));
  });

  it('shows an error sentence with Retry on a 500, header kept', async () => {
    server.use(
      http.get('/api/v1/fees/fines', () => HttpResponse.json({ message: 'boom' }, { status: 500 })),
      ...referenceHandlers(),
    );
    render();
    await screen.findByRole('heading', { name: 'Fines' });
    expect(await screen.findByText("Couldn't load fines.", {}, { timeout: 5000 })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Retry' })).toBeTruthy();
  });

  it('header offers Fine rules, which navigates to the rules page', async () => {
    server.use(finesHandler([]), ...referenceHandlers());
    const { router } = render();
    const user = userEvent.setup();
    await screen.findByRole('heading', { name: 'Fines' });
    await user.click(screen.getByRole('button', { name: 'Fine rules' }));
    await waitFor(() => expect(router.state.location.pathname).toBe('/fees/fines/rules'));
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

  it('shows an empty state, with the header still present, when there are no fines', async () => {
    server.use(finesHandler([]), ...referenceHandlers());

    render();

    expect(await screen.findByText('No fines yet')).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Fines' })).toBeTruthy();
    expect(screen.getAllByRole('button', { name: 'Log fine' }).length).toBeGreaterThan(0);
    expect(screen.getByRole('button', { name: 'Make fines from rules' })).toBeTruthy();
  });

  it.each([
    ['logFine', 'Log fine'],
    ['generateFines', 'Make fines from rules'],
  ])(
    'opens the dialog from the palette flag ?%s=1 (router parses it to a number)',
    async (flag, title) => {
      server.use(finesHandler([]), ...referenceHandlers());

      render('ADMIN', `/fees/fines?${flag}=1`);

      expect(await screen.findByRole('dialog', { name: title })).toBeTruthy();
    },
  );

  it('reflects the modal in the URL: opening sets ?generateFines, Close removes it', async () => {
    server.use(finesHandler([]), ...referenceHandlers());
    const { router } = render();
    const user = userEvent.setup();

    await user.click(await screen.findByRole('button', { name: 'Make fines from rules' }));
    expect(await screen.findByRole('dialog', { name: 'Make fines from rules' })).toBeTruthy();
    expect(router.state.location.search).toMatchObject({ generateFines: '1' });

    await user.click(screen.getByRole('button', { name: 'Close' }));
    await waitFor(() => expect(router.state.location.search).not.toHaveProperty('generateFines'));
    await waitFor(() =>
      expect(screen.queryByRole('dialog', { name: 'Make fines from rules' })).toBeNull(),
    );
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
    expect(screen.queryByRole('button', { name: 'Make fines from rules' })).toBeNull();
  });

  it('shows no modal to an EXECUTIVE who lands on ?logFine=1', async () => {
    server.use(finesHandler([]), ...referenceHandlers());
    render('EXECUTIVE', '/fees/fines?logFine=1');
    await screen.findByRole('heading', { name: 'Fines' });
    expect(screen.queryByRole('dialog', { name: 'Log fine' })).toBeNull();
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
    expect(screen.getAllByRole('link', { name: 'Open student' }).length).toBeGreaterThan(0);
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

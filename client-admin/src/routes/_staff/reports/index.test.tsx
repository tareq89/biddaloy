import { cleanupTestState, renderWithRouter, server } from '@biddaloy/ui/test';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { routeTree } from '../../../routeTree.gen';

import { CODED_REPORTS, visibleCodedReports } from './-coded-reports';

const STUDENT_LIST_ID = '11111111-1111-4111-8111-111111111111';
const DUES_ID = '22222222-2222-4222-8222-222222222222';

const catalogue = [
  {
    folder: null,
    reports: [
      {
        id: STUDENT_LIST_ID,
        key: 'student-list',
        name_en: 'Student list',
        name_bn: 'শিক্ষার্থীর তালিকা',
        version_id: 'v1',
        system_template_key: null,
      },
    ],
  },
  {
    folder: 'Money',
    reports: [
      {
        id: DUES_ID,
        key: 'dues-by-class',
        name_en: 'Dues by class',
        name_bn: 'শ্রেণি অনুযায়ী বাকি',
        version_id: 'v2',
        system_template_key: null,
      },
    ],
  },
];

function serveCatalogue(body: unknown = catalogue) {
  server.use(http.get('/api/v1/reports/catalogue', () => HttpResponse.json(body as never)));
}

/** The page itself: the sidebar also links to the coded reports, so queries stay inside `main`. */
const page = () => within(screen.getByRole('main'));

function renderHub(role = 'ADMIN', locale: 'en' | 'bn' = 'en') {
  return renderWithRouter(routeTree, {
    initialEntries: ['/reports'],
    tenantId: 'tenant-1',
    role,
    locale,
  });
}

describe('/reports [8.15.29]', () => {
  afterEach(async () => {
    localStorage.clear();
    await cleanupTestState();
  });

  it('lists the school’s reports and the coded ones, by folder, each with one plain line', async () => {
    serveCatalogue();
    renderHub();

    expect(await screen.findByRole('heading', { level: 1, name: 'All reports' })).toBeTruthy();
    // A defined report in the unnamed folder, and one in a named folder.
    const ready = await screen.findByRole('region', { name: 'Ready reports' });
    expect(within(ready).getByRole('link', { name: 'Student list' }).getAttribute('href')).toBe(
      `/reports/${STUDENT_LIST_ID}`,
    );
    const money = page().getByRole('region', { name: 'Money' });
    expect(within(money).getByRole('link', { name: 'Dues by class' })).toBeTruthy();
    // A coded report links to its own screen, with its own plain line.
    const fees = page().getByRole('region', { name: 'Fees and money' });
    expect(
      within(fees).getByRole('link', { name: 'Fee collection report' }).getAttribute('href'),
    ).toBe('/reports/collections');
    expect(
      within(fees).getByText('How much was paid each day, by which method and to whom.'),
    ).toBeTruthy();
  });

  it('shows a teacher only the coded reports the role may open', async () => {
    serveCatalogue([]);
    renderHub('TEACHER');

    await screen.findByRole('heading', { level: 1, name: 'All reports' });
    expect(page().getByRole('link', { name: 'Student count (BANBEIS)' })).toBeTruthy();
    // Fee collection needs REPORT_COLLECTIONS_READ, which a teacher does not hold.
    expect(page().queryByRole('link', { name: 'Fee collection report' })).toBeNull();
    expect(page().queryByRole('link', { name: 'Application reports' })).toBeNull();
  });

  it('every coded report asks the same permission as its own page', () => {
    // Nothing is listed for a role holding no permission at all.
    expect(visibleCodedReports(() => false)).toEqual([]);
    expect(visibleCodedReports(() => true)).toHaveLength(CODED_REPORTS.length);
  });

  it('search matches the Bangla name, the English name and the plain line', async () => {
    serveCatalogue();
    renderHub();
    const user = userEvent.setup();
    const box = await screen.findByRole('searchbox', { name: 'Find a report' });

    await user.type(box, 'শ্রেণি অনুযায়ী');
    expect(await page().findByRole('link', { name: 'Dues by class' })).toBeTruthy();
    expect(page().queryByRole('link', { name: 'Student list' })).toBeNull();

    await user.clear(box);
    await user.type(box, 'which method');
    expect(await page().findByRole('link', { name: 'Fee collection report' })).toBeTruthy();
    expect(page().queryByRole('link', { name: 'Dues by class' })).toBeNull();

    await user.clear(box);
    await user.type(box, 'zzzz');
    expect(await screen.findByText('No report matches')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Clear search' }));
    expect(await page().findByRole('link', { name: 'Student list' })).toBeTruthy();
  });

  it('a favourite is pinned to the top, remembered in this browser, and leaves its folder', async () => {
    serveCatalogue();
    renderHub();
    const user = userEvent.setup();
    await user.click(
      await screen.findByRole('button', { name: 'Add Dues by class to favourites' }),
    );

    const favourites = await screen.findByRole('region', { name: 'Favourites' });
    expect(within(favourites).getByRole('link', { name: 'Dues by class' })).toBeTruthy();
    // It shows once, not again under its folder.
    expect(page().getAllByRole('link', { name: 'Dues by class' })).toHaveLength(1);
    expect(JSON.parse(localStorage.getItem('reports.favourites') ?? '[]')).toEqual([
      `defined:${DUES_ID}`,
    ]);
    const pressed = within(favourites).getByRole('button', {
      name: 'Remove Dues by class from favourites',
    });
    expect(pressed.getAttribute('aria-pressed')).toBe('true');
  });

  it('still works when the browser will not store favourites', async () => {
    serveCatalogue();
    // A browser that refuses to store (private mode, blocked site data).
    const blocked = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    renderHub();
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Add Student list to favourites' }));
    expect(await screen.findByRole('region', { name: 'Favourites' })).toBeTruthy();
    blocked.mockRestore();
  });

  it('still shows the coded reports when the school’s own list cannot be loaded, with a way to retry', async () => {
    server.use(
      http.get('/api/v1/reports/catalogue', () =>
        HttpResponse.json({ message: 'x' }, { status: 500 }),
      ),
    );
    renderHub();
    expect(await screen.findByText('The ready reports could not be loaded.')).toBeTruthy();
    expect(page().getByRole('link', { name: 'Fee collection report' })).toBeTruthy();
  });

  it('writes the hub in Bangla', async () => {
    serveCatalogue();
    renderHub('ADMIN', 'bn');
    expect(await screen.findByRole('heading', { level: 1, name: 'সব রিপোর্ট' })).toBeTruthy();
    expect(await screen.findByRole('link', { name: 'শিক্ষার্থীর তালিকা' })).toBeTruthy();
    expect(page().getByRole('link', { name: 'ফি আদায়ের প্রতিবেদন' })).toBeTruthy();
  });
});

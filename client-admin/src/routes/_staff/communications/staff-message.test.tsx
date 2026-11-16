/** [80.2.02] The Message staff route: who may open it, and no developer words on the page. */
import { renderWithRouter, server, cleanupTestState } from '@biddaloy/ui/test';
import { screen } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { afterEach, describe, expect, it } from 'vitest';

import { routeTree } from '../../../routeTree.gen';

const render = (role: string) =>
  renderWithRouter(routeTree, {
    initialEntries: ['/communications/staff-message'],
    tenantId: 'tenant-1',
    role,
    locale: 'en',
  });

const NEVER_SAY = ['recipient', 'audience', 'payload', 'segment', 'ledger', 'batch'];

describe('/communications/staff-message', () => {
  afterEach(async () => {
    await cleanupTestState();
  });

  it('renders for a holder of STAFF_MESSAGE_SEND, with the Staff tab chosen and no glossary terms', async () => {
    server.use(
      http.get('/api/v1/users', () =>
        HttpResponse.json({ data: [], total: 0, page: 1, limit: 100, totalPages: 0 }),
      ),
      http.get('/api/v1/designations', () => HttpResponse.json([])),
    );
    const { container } = render('ADMIN');

    await screen.findByRole('heading', { level: 1, name: 'Message staff' });
    expect(screen.getByRole('tab', { name: 'Staff' }).getAttribute('aria-selected')).toBe('true');
    expect(screen.getByRole('checkbox', { name: 'All teachers' })).toBeTruthy();
    const text = (container.textContent ?? '').toLowerCase();
    for (const word of NEVER_SAY) expect(text).not.toContain(word);
  });

  it('is refused to a role without STAFF_MESSAGE_SEND', async () => {
    render('TEACHER');

    expect(await screen.findByText("You don't have access to this page.")).toBeTruthy();
    expect(screen.queryByRole('textbox', { name: 'Message' })).toBeNull();
  });

  it('shows the Guardians | Staff switch on the guardian page only to STAFF_MESSAGE_SEND holders', async () => {
    const guardianPage = (role: string) =>
      renderWithRouter(routeTree, {
        initialEntries: ['/communications/send'],
        tenantId: 'tenant-1',
        role,
        locale: 'en',
      });
    guardianPage('ADMIN');
    expect(await screen.findByRole('tab', { name: 'Staff' })).toBeTruthy();
    await cleanupTestState();

    guardianPage('ACCOUNTANT');
    await screen.findByRole('heading', { name: 'Send Message' });
    expect(screen.queryByRole('tab', { name: 'Staff' })).toBeNull();
  });
});

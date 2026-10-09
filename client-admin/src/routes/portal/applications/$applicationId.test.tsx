import type { ApplicationDto } from '@biddaloy/ui/hooks';
import { cleanupTestState, renderWithRouter, server } from '@biddaloy/ui/test';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { afterEach, describe, expect, it } from 'vitest';

import { routeTree } from '../../../routeTree.gen';
import { applicationDto } from '../../_staff/applications/-detail/-application-fixture';

const OPEN_CAN = { decide: false, consider: false, withdraw: true, cancel: false, comment: true };

function render(dto: ApplicationDto) {
  const withdrawn: string[] = [];
  server.use(
    http.get('/api/v1/applications/:id', () => HttpResponse.json(dto)),
    http.post('/api/v1/applications/:id/withdraw', ({ params }) => {
      withdrawn.push(params.id as string);
      return HttpResponse.json({ ...dto, status: 'WITHDRAWN' });
    }),
  );
  renderWithRouter(routeTree, {
    initialEntries: [`/portal/applications/${dto.id}`],
    tenantId: 'tenant-1',
    role: 'PARENT',
    locale: 'en',
  });
  return withdrawn;
}

describe('/portal/applications/$applicationId', () => {
  afterEach(async () => {
    await cleanupTestState();
  });

  it('an open application can be withdrawn after a confirm', async () => {
    const withdrawn = render(applicationDto({ can: OPEN_CAN }));
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Withdraw' }));
    const dialog = await screen.findByRole('alertdialog');
    await user.click(within(dialog).getByRole('button', { name: 'Withdraw' }));
    await waitFor(() => expect(withdrawn).toEqual([applicationDto().id]));
  });

  it('never shows Approve, even when the server says can.decide', async () => {
    render(applicationDto({ can: { ...OPEN_CAN, decide: true, consider: true, cancel: true } }));
    await screen.findByRole('button', { name: 'Withdraw' });
    for (const name of ['Approve', 'Reject', 'Cancel', 'Consider']) {
      expect(screen.queryByRole('button', { name })).toBeNull();
    }
  });

  it('hides the tag adder, keeps the comment box and a back link to the child list', async () => {
    render(applicationDto({ can: OPEN_CAN }));
    expect(await screen.findByLabelText('Write a comment')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Add tags' })).toBeNull();
    expect(
      screen
        .getAllByRole('link')
        .some((l) => l.getAttribute('href') === '/portal/applications?student=s-1'),
    ).toBe(true);
  });

  it('a missing application shows the not-found state with a way back', async () => {
    server.use(
      http.get('/api/v1/applications/:id', () =>
        HttpResponse.json(
          {
            statusCode: 404,
            message: 'Not found',
            timestamp: new Date().toISOString(),
            path: '/x',
            requestId: 'r',
          },
          { status: 404 },
        ),
      ),
    );
    renderWithRouter(routeTree, {
      initialEntries: ['/portal/applications/7c1e0000-0000-4000-8000-0000000000ff'],
      tenantId: 'tenant-1',
      role: 'PARENT',
      locale: 'en',
    });
    expect(await screen.findByText('This application could not be found.')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Back to applications' })).toBeTruthy();
  });
});

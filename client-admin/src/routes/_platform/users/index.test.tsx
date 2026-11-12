import { UserRole } from '@biddaloy/shared';
import { cleanupTestState, renderWithRouter, server } from '@biddaloy/ui/test';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { afterEach, describe, expect, it } from 'vitest';

import { routeTree } from '../../../routeTree.gen';

const render = () =>
  renderWithRouter(routeTree, {
    initialEntries: ['/users'],
    tenantId: 'tenant-1',
    role: UserRole.SUPER_ADMIN,
    locale: 'en',
  });

afterEach(async () => {
  await cleanupTestState();
});

describe('/users', () => {
  it('waits for 3 characters, then searches once after typing stops', async () => {
    const seen: (string | null)[] = [];
    server.use(
      http.get('*/platform/users', ({ request }) => {
        seen.push(new URL(request.url).searchParams.get('q'));
        return HttpResponse.json([]);
      }),
    );
    render();
    const box = await screen.findByRole('searchbox', { name: 'Search phone or email' });
    await userEvent.type(box, '01');
    expect(screen.getByText('Type at least 3 characters.')).toBeTruthy();
    await userEvent.type(box, '7123');
    expect(await screen.findByText('No one found.')).toBeTruthy();
    expect(seen).toEqual(['017123']);
  });

  it('shows schools and roles, and Login as opens the dialog for that school', async () => {
    render();
    await userEvent.type(await screen.findByRole('searchbox'), 'anika');
    expect(await screen.findByText('Rose Valley School (Teacher)')).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: /^Login as Anika Rahman at Rose/ }));
    expect(await screen.findByText('Login as - Rose Valley School')).toBeTruthy();
    expect(screen.getByRole('combobox', { name: 'Role' }).textContent).toContain('Teacher');
  });

  it('an error never echoes what was typed', async () => {
    server.use(
      http.get('*/platform/users', () => HttpResponse.json({ message: 'x' }, { status: 400 })),
    );
    render();
    await userEvent.type(await screen.findByRole('searchbox'), 'secret-needle@example.test');
    await waitFor(() => expect(screen.getByRole('alert')).toBeTruthy());
    expect(screen.getByRole('alert').textContent).toBe('Could not search. Try again.Try again');
    expect(document.body.textContent).not.toContain('needle');
  });
});

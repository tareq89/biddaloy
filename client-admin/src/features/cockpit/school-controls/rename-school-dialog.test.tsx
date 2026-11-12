import '@biddaloy/ui/test';

import { ApprovalModalHostProvider } from '@biddaloy/ui/hooks';
import { cleanupTestState, renderWithProviders, server } from '@biddaloy/ui/test';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { RenameSchoolDialog } from './rename-school-dialog';

const view = (onOpenChange = vi.fn()) =>
  renderWithProviders(
    <ApprovalModalHostProvider>
      <RenameSchoolDialog
        open
        onOpenChange={onOpenChange}
        schoolId="s-1"
        currentName="Rose Valley School"
      />
    </ApprovalModalHostProvider>,
    { locale: 'en', role: 'SUPER_ADMIN', tenantId: 'platform' },
  );

const needsCode = (calls: (string | null)[], fail = false) =>
  http.patch('*/platform/schools/:id/name', ({ request }) => {
    const token = request.headers.get('X-Approval-Token');
    calls.push(token);
    if (token && !fail) return HttpResponse.json({ name: 'New', name_bn: null, changed: true });
    return HttpResponse.json(
      {
        statusCode: token ? 500 : 403,
        message: 'leaky server text',
        timestamp: '',
        path: '/',
        requestId: 'r',
        details: token ? undefined : { code: 'APPROVAL_REQUIRED' },
      },
      { status: token ? 500 : 403 },
    );
  });

async function fill(user: ReturnType<typeof userEvent.setup>) {
  await user.type(await screen.findByLabelText(/New name/), 'Green Valley School');
  await user.type(screen.getByLabelText(/Reason/), 'Owner asked');
  await user.click(screen.getByRole('button', { name: 'Rename' }));
}

afterEach(async () => {
  await cleanupTestState();
});

describe('RenameSchoolDialog', () => {
  it('shows the old name, asks for a code, then renames and closes', async () => {
    const calls: (string | null)[] = [];
    server.use(needsCode(calls));
    const onOpenChange = vi.fn();
    const user = userEvent.setup();
    const { container } = view(onOpenChange);
    expect(await screen.findByText('Current name: Rose Valley School')).toBeTruthy();
    await expect(container).toHaveNoViolations();
    await fill(user);
    await user.type(await screen.findByLabelText('Authenticator code'), '123456');
    await user.keyboard('{Enter}');
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
    expect(calls).toEqual([null, 'owner-token']);
  });

  it('a wrong code keeps the prompt open and renames nothing', async () => {
    const calls: (string | null)[] = [];
    server.use(
      needsCode(calls),
      http.post('*/platform/step-up', () =>
        HttpResponse.json(
          { statusCode: 403, message: 'nope', timestamp: '', path: '/', requestId: 'r' },
          { status: 403 },
        ),
      ),
    );
    const onOpenChange = vi.fn();
    const user = userEvent.setup();
    view(onOpenChange);
    await fill(user);
    await user.type(await screen.findByLabelText('Authenticator code'), '000000');
    await user.keyboard('{Enter}');
    expect(await screen.findByText(/isn't valid/)).toBeTruthy();
    expect(calls).toEqual([null]);
    expect(onOpenChange).not.toHaveBeenCalled();
  });

  it('a server error shows one fixed sentence, no echo', async () => {
    server.use(needsCode([], true));
    const user = userEvent.setup();
    view();
    await fill(user);
    await user.type(await screen.findByLabelText('Authenticator code'), '123456');
    await user.keyboard('{Enter}');
    await waitFor(() =>
      expect(screen.getByText('Could not rename the school. Try again.')).toBeTruthy(),
    );
    expect(document.body.textContent).not.toContain('leaky server text');
  });
});

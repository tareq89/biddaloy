import '@biddaloy/ui/test';

import { ApprovalModalHostProvider } from '@biddaloy/ui/hooks';
import { cleanupTestState, renderWithProviders, server } from '@biddaloy/ui/test';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ArchiveSchoolDialog } from './archive-school-dialog';

const view = (onOpenChange = vi.fn()) =>
  renderWithProviders(
    <ApprovalModalHostProvider>
      <ArchiveSchoolDialog
        open
        onOpenChange={onOpenChange}
        schoolId="s-1"
        schoolName="Rose Valley School"
      />
    </ApprovalModalHostProvider>,
    { locale: 'en', role: 'SUPER_ADMIN', tenantId: 'platform' },
  );

const archiveButton = () => screen.getByRole('button', { name: 'Archive school' });

const archiveRoute = (calls: (string | null)[], fail = false) =>
  http.post('*/platform/schools/:id/archive', ({ request, params }) => {
    const token = request.headers.get('X-Approval-Token');
    calls.push(token);
    if (token && !fail) {
      return HttpResponse.json({ id: params.id, status: 'SUSPENDED', exportJobId: 'j' });
    }
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

beforeEach(() => {
  URL.createObjectURL = vi.fn(() => 'blob:x');
  URL.revokeObjectURL = vi.fn();
  server.use(
    http.get(
      '*/backup/jobs/:id/download',
      () =>
        new HttpResponse(new Blob(['x']), {
          headers: { 'content-disposition': 'attachment; filename="school.zip"' },
        }),
    ),
  );
});

afterEach(async () => {
  await cleanupTestState();
});

async function prepareAndDownload(user: ReturnType<typeof userEvent.setup>) {
  await user.click(await screen.findByRole('button', { name: 'Prepare the copy' }));
  await user.click(await screen.findByRole('button', { name: 'Download the copy' }));
  await screen.findByText('The copy is downloaded.');
}

describe('ArchiveSchoolDialog', () => {
  it('lists what is exported and keeps Archive disabled until the copy is downloaded', async () => {
    const user = userEvent.setup();
    const { container } = view();
    expect(await screen.findByText('Students and guardians')).toBeTruthy();
    await expect(container).toHaveNoViolations();
    await user.type(screen.getByLabelText('Reason'), 'School closed');
    expect(archiveButton()).toHaveProperty('disabled', true);
    await user.click(screen.getByRole('button', { name: 'Prepare the copy' }));
    await screen.findByRole('button', { name: 'Download the copy' });
    expect(archiveButton()).toHaveProperty('disabled', true);
    await user.click(screen.getByRole('button', { name: 'Download the copy' }));
    await screen.findByText('The copy is downloaded.');
    expect(archiveButton()).toHaveProperty('disabled', false);
  });

  it('archives only with a code, then closes', async () => {
    const calls: (string | null)[] = [];
    server.use(archiveRoute(calls));
    const onOpenChange = vi.fn();
    const user = userEvent.setup();
    view(onOpenChange);
    await prepareAndDownload(user);
    await user.type(screen.getByLabelText('Reason'), 'School closed');
    await user.click(archiveButton());
    await user.type(await screen.findByLabelText('Authenticator code'), '123456');
    await user.keyboard('{Enter}');
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
    expect(calls).toEqual([null, 'owner-token']);
  });

  it('a wrong code archives nothing', async () => {
    const calls: (string | null)[] = [];
    server.use(
      archiveRoute(calls),
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
    await prepareAndDownload(user);
    await user.type(screen.getByLabelText('Reason'), 'School closed');
    await user.click(archiveButton());
    await user.type(await screen.findByLabelText('Authenticator code'), '000000');
    await user.keyboard('{Enter}');
    expect(await screen.findByText(/isn't valid/)).toBeTruthy();
    expect(calls).toEqual([null]);
    expect(onOpenChange).not.toHaveBeenCalled();
  });

  it('a server error shows a fixed sentence, no echo', async () => {
    server.use(archiveRoute([], true));
    const user = userEvent.setup();
    view();
    await prepareAndDownload(user);
    await user.type(screen.getByLabelText('Reason'), 'School closed');
    await user.click(archiveButton());
    await user.type(await screen.findByLabelText('Authenticator code'), '123456');
    await user.keyboard('{Enter}');
    await screen.findByText('Could not archive the school. Try again.');
    expect(document.body.textContent).not.toContain('leaky server text');
  });

  it('a failed export says so and offers no download', async () => {
    server.use(
      http.get('*/platform/schools/:id/archive/export/:jobId', ({ params }) =>
        HttpResponse.json({
          id: params.jobId,
          status: 'FAILED',
          sizeBytes: null,
          pinned: false,
          error: 'internal detail',
          expiresAt: null,
          finishedAt: null,
        }),
      ),
    );
    const user = userEvent.setup();
    view();
    await user.click(await screen.findByRole('button', { name: 'Prepare the copy' }));
    await screen.findByText('Could not prepare the copy. Try again.');
    expect(screen.queryByRole('button', { name: 'Download the copy' })).toBeNull();
    expect(document.body.textContent).not.toContain('internal detail');
    expect(archiveButton()).toHaveProperty('disabled', true);
  });
});

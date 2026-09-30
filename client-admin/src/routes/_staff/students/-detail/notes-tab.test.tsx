import '@biddaloy/ui/test';

import { RegionConfigProvider } from '@biddaloy/ui/i18n';
import { cleanupTestState, renderWithProviders, server } from '@biddaloy/ui/test';
import { screen, waitFor, within } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { afterEach, describe, expect, it } from 'vitest';

import { NotesTab } from './notes-tab';

const STUDENT_ID = 'student-1';
const ME = 'user-me';

// `useCurrentUserId` decodes the `sub` claim; signature is never checked client-side.
const tokenFor = (sub: string) => `h.${btoa(JSON.stringify({ sub }))}.s`;

const note = (overrides: Record<string, unknown> = {}) => ({
  id: 'note-1',
  body: 'Needs extra reading support',
  author: { id: 'user-other', name: 'Karim Sir' },
  created_at: '2026-01-05T10:00:00.000Z',
  ...overrides,
});

function renderTab(options: { notes?: unknown[]; role?: string } = {}) {
  const notes = options.notes ?? [note()];
  server.use(http.get('/api/v1/students/:id/notes', () => HttpResponse.json(notes)));
  return renderWithProviders(
    <RegionConfigProvider>
      <NotesTab studentId={STUDENT_ID} />
    </RegionConfigProvider>,
    {
      locale: 'en',
      role: options.role ?? 'TEACHER',
      tenantId: 'tenant-1',
      accessToken: tokenFor(ME),
    },
  );
}

describe('students/-detail/notes-tab', () => {
  afterEach(async () => {
    await cleanupTestState();
  });

  it('lists notes as cards with author and body, and passes axe', async () => {
    const { baseElement } = renderTab();
    expect(await screen.findByText('Needs extra reading support')).toBeTruthy();
    expect(screen.getByText('Karim Sir')).toBeTruthy();
    await expect(baseElement).toHaveNoViolations();
  });

  it('shows the empty state with the add button', async () => {
    renderTab({ notes: [] });
    expect(await screen.findByText('No notes yet')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Add note' })).toBeTruthy();
  });

  it('shows the forbidden message on a 403', async () => {
    server.use(
      http.get('/api/v1/students/:id/notes', () =>
        HttpResponse.json({ message: 'Forbidden' }, { status: 403 }),
      ),
    );
    renderWithProviders(
      <RegionConfigProvider>
        <NotesTab studentId={STUDENT_ID} />
      </RegionConfigProvider>,
      { locale: 'en', role: 'TEACHER', tenantId: 'tenant-1', accessToken: tokenFor(ME) },
    );
    expect(await screen.findByRole('alert')).toBeTruthy();
    expect(screen.queryByText('Needs extra reading support')).toBeNull();
  });

  it('adds a note (Ctrl+Enter saves) and sends the trimmed body', async () => {
    let posted: unknown;
    server.use(
      http.post('/api/v1/students/:id/notes', async ({ request }) => {
        posted = await request.json();
        return HttpResponse.json(note({ id: 'note-2' }), { status: 201 });
      }),
    );
    const { user } = renderTab({ notes: [] });
    await user.click(await screen.findByRole('button', { name: 'Add note' }));
    const dialog = await screen.findByRole('dialog');
    await user.type(within(dialog).getByLabelText('Note'), '  Met parents  ');
    await user.keyboard('{Control>}{Enter}{/Control}');
    await waitFor(() => expect(posted).toEqual({ body: 'Met parents' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('disables save for a blank note', async () => {
    const { user } = renderTab({ notes: [] });
    await user.click(await screen.findByRole('button', { name: 'Add note' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByRole('button', { name: 'Save note' }).hasAttribute('disabled')).toBe(
      true,
    );
  });

  it('hides Delete from a non-author non-admin', async () => {
    renderTab({ notes: [note()], role: 'TEACHER' });
    await screen.findByText('Needs extra reading support');
    expect(screen.queryByRole('button', { name: 'Delete' })).toBeNull();
  });

  it('shows Delete to the author and to an ADMIN', async () => {
    const own = renderTab({ notes: [note({ author: { id: ME, name: 'Me' } })] });
    expect(await screen.findByRole('button', { name: 'Delete' })).toBeTruthy();
    own.unmount();
    await cleanupTestState();

    renderTab({ notes: [note()], role: 'ADMIN' });
    expect(await screen.findByRole('button', { name: 'Delete' })).toBeTruthy();
  });

  it('deletes behind a confirm dialog', async () => {
    let deleted: string | undefined;
    server.use(
      http.delete('/api/v1/students/:id/notes/:noteId', ({ params }) => {
        deleted = params.noteId as string;
        return new HttpResponse(null, { status: 204 });
      }),
    );
    const { user } = renderTab({ role: 'ADMIN' });
    await user.click(await screen.findByRole('button', { name: 'Delete' }));
    const dialog = await screen.findByRole('dialog');
    expect(deleted).toBeUndefined();
    await user.click(within(dialog).getByRole('button', { name: 'Delete' }));
    await waitFor(() => expect(deleted).toBe('note-1'));
  });
});

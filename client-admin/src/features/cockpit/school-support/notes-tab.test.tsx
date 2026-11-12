import '@biddaloy/ui/test';

import { cleanupTestState, renderWithProviders, server } from '@biddaloy/ui/test';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { afterEach, describe, expect, it } from 'vitest';

import { NotesTab } from './notes-tab';

const note = (id: string, authorId: string, text: string) => ({
  id,
  authorId,
  text,
  createdAt: '2030-01-01T10:00:00.000Z',
});
const view = () =>
  renderWithProviders(<NotesTab schoolId="s-1" currentUserId="me" />, {
    locale: 'en',
    role: 'SUPER_ADMIN',
    tenantId: 'platform',
  });
const serve = (list: unknown[]) =>
  server.use(http.get('*/platform/schools/:id/notes', () => HttpResponse.json(list)));

afterEach(async () => {
  await cleanupTestState();
});

describe('NotesTab', () => {
  it('lists notes and offers delete only on your own', async () => {
    serve([note('1', 'me', 'Mine'), note('2', 'other', 'Theirs')]);
    const { container } = view();
    expect(await screen.findByText('Mine')).toBeTruthy();
    expect(screen.getByText('Theirs')).toBeTruthy();
    expect(screen.getAllByRole('button', { name: 'Delete note' })).toHaveLength(1);
    await expect(container).toHaveNoViolations();
  });

  it('adds a note, with a counter', async () => {
    serve([]);
    let body: Record<string, unknown> = {};
    server.use(
      http.post('*/platform/schools/:id/notes', async ({ request }) => {
        body = (await request.json()) as Record<string, unknown>;
        return HttpResponse.json(note('3', 'me', 'Called the principal'));
      }),
    );
    const user = userEvent.setup();
    view();
    await screen.findByText('No notes yet.');
    await user.type(screen.getByLabelText('New note'), 'Called the principal');
    expect(screen.getByText(/^(20|২০) \/ /)).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Add note' }));
    await waitFor(() => expect(body).toEqual({ text: 'Called the principal' }));
  });

  it('blocks more than 2000 characters', async () => {
    serve([]);
    const user = userEvent.setup();
    view();
    const box = await screen.findByLabelText('New note');
    await user.click(box);
    await user.paste('a'.repeat(2001));
    expect(screen.getByText('A note can be at most 2000 characters.')).toBeTruthy();
    expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Add note' }).disabled).toBe(true);
  });

  it('deletes your own note after confirming', async () => {
    serve([note('1', 'me', 'Mine')]);
    let deleted = '';
    server.use(
      http.delete('*/platform/schools/:id/notes/:noteId', ({ params }) => {
        deleted = String(params.noteId);
        return new HttpResponse(null, { status: 204 });
      }),
    );
    const user = userEvent.setup();
    view();
    await user.click(await screen.findByRole('button', { name: 'Delete note' }));
    const dialog = await screen.findByRole('alertdialog');
    await user.click(
      Array.from(dialog.querySelectorAll('button')).find(
        (b) => b.textContent === 'Delete note',
      ) as HTMLElement,
    );
    await waitFor(() => expect(deleted).toBe('1'));
  });

  it('a failed load shows one fixed sentence', async () => {
    server.use(
      http.get('*/platform/schools/:id/notes', () =>
        HttpResponse.json({ message: 'leaky' }, { status: 500 }),
      ),
    );
    view();
    expect(await screen.findByText('Could not load the notes.')).toBeTruthy();
    expect(screen.queryByText(/leaky/)).toBeNull();
  });

  it('a failed add keeps the text and shows one sentence', async () => {
    serve([]);
    server.use(
      http.post('*/platform/schools/:id/notes', () =>
        HttpResponse.json({ message: 'leaky' }, { status: 500 }),
      ),
    );
    const user = userEvent.setup();
    view();
    await user.type(await screen.findByLabelText('New note'), 'Hello');
    await user.click(screen.getByRole('button', { name: 'Add note' }));
    expect(await screen.findByText('Could not add the note. Try again.')).toBeTruthy();
    expect(screen.getByLabelText<HTMLTextAreaElement>('New note').value).toBe('Hello');
  });
});

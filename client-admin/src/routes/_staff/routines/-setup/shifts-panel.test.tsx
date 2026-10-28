import '@biddaloy/ui/test';

import { toast } from '@biddaloy/ui/components';
import { REGION_BD_BN } from '@biddaloy/ui/i18n';
import { apiErrorBody, cleanupTestState, renderWithProviders, server } from '@biddaloy/ui/test';
import { formatTime } from '@biddaloy/ui/utils';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ShiftsPanel } from './shifts-panel';

const SCHOOL_ID = 'school-1';

const SHIFT = {
  id: 'shift-1',
  name: 'Morning',
  day_starts_at: '08:00:00',
  day_ends_at: '13:00:00',
  sequence: 0,
};

function mockShifts() {
  server.use(
    http.get('*/routines/shifts', () =>
      HttpResponse.json({ data: [SHIFT], total: 1, page: 1, limit: 100, totalPages: 1 }),
    ),
  );
}

function renderPanel() {
  return renderWithProviders(<ShiftsPanel />, {
    locale: 'en',
    role: 'ADMIN',
    tenantId: SCHOOL_ID,
  });
}

describe('ShiftsPanel', () => {
  afterEach(async () => {
    await cleanupTestState();
  });

  it('lists shifts with formatted times, never the raw 08:00:00', async () => {
    mockShifts();
    renderPanel();

    expect(await screen.findByText('Morning')).toBeTruthy();
    expect(screen.getAllByText(formatTime('08:00:00', REGION_BD_BN)).length).toBeGreaterThan(0);
    expect(screen.queryByText('08:00:00')).toBeNull();
  });

  it('asks before deleting, and a 409 shows the translated sentence, never the server message', async () => {
    mockShifts();
    let deleted = false;
    server.use(
      http.delete('*/routines/shifts/:id', () => {
        deleted = true;
        return HttpResponse.json(
          {
            statusCode: 409,
            message:
              'Cannot delete this shift: 2 period slot(s) still reference it. Remove them first.',
            timestamp: new Date().toISOString(),
            path: '/routines/shifts/shift-1',
            requestId: 'req-1',
          },
          { status: 409 },
        );
      }),
    );
    const errorSpy = vi.spyOn(toast, 'error').mockImplementation(() => '');
    try {
      renderPanel();
      const user = userEvent.setup();

      await user.click(await screen.findByRole('button', { name: 'Delete' }));
      const dialog = await screen.findByRole('alertdialog');
      expect(within(dialog).getByText('Delete Morning?')).toBeTruthy();
      expect(deleted).toBe(false);

      await user.click(within(dialog).getByRole('button', { name: 'Delete' }));
      await waitFor(() =>
        expect(errorSpy).toHaveBeenCalledWith(
          "This shift still has period times, so it can't be deleted. Remove its rows under Period times first.",
        ),
      );
    } finally {
      errorSpy.mockRestore();
    }
  });

  it('adds a shift from a dialog with two time pickers and the same payload as before', async () => {
    mockShifts();
    let posted: unknown = null;
    server.use(
      http.post('*/routines/shifts', async ({ request }) => {
        posted = await request.json();
        return HttpResponse.json({ ...SHIFT, id: 'shift-2', name: 'Evening', sequence: 1 });
      }),
    );
    const { container } = renderPanel();
    const user = userEvent.setup();

    await user.click(await screen.findByRole('button', { name: 'Add shift' }));
    await user.type(await screen.findByLabelText('Name'), 'Evening');
    expect(screen.getAllByRole('combobox')).toHaveLength(2);
    expect(container.querySelector('input[type="time"]')).toBeNull();
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Add' }));

    await waitFor(() =>
      expect(posted).toEqual({
        name: 'Evening',
        day_starts_at: '08:00',
        day_ends_at: '16:00',
        sequence: 1,
      }),
    );
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  describe('name checks [2615]', () => {
    async function openDialog() {
      mockShifts();
      const posts: unknown[] = [];
      server.use(
        http.post('*/routines/shifts', async ({ request }) => {
          posts.push(await request.json());
          return HttpResponse.json({ ...SHIFT, id: 'shift-2', sequence: 1 });
        }),
      );
      renderPanel();
      const user = userEvent.setup();
      await user.click(await screen.findByRole('button', { name: 'Add shift' }));
      const input = await screen.findByLabelText('Name');
      const add = () =>
        user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Add' }));
      return { posts, input, add, user };
    }

    it('spaces only show the required error and send nothing', async () => {
      const { posts, input, add } = await openDialog();
      fireEvent.change(input, { target: { value: '   ' } });
      await add();
      expect(await screen.findByText('Enter a shift name.')).toBeTruthy();
      expect(input.getAttribute('aria-invalid')).toBe('true');
      expect(posts).toHaveLength(0);
    });

    it('101 characters show the too-long error and send nothing', async () => {
      const { posts, input, add } = await openDialog();
      fireEvent.change(input, { target: { value: 'a'.repeat(101) } });
      await add();
      expect(await screen.findByText('The name can be at most 100 characters.')).toBeTruthy();
      expect(posts).toHaveLength(0);
    });

    it('a valid name is sent trimmed', async () => {
      const { posts, input, add } = await openDialog();
      fireEvent.change(input, { target: { value: '  Evening  ' } });
      await add();
      await waitFor(() => expect(posts).toHaveLength(1));
      expect(posts[0]).toMatchObject({ name: 'Evening' });
    });

    it('a server 400 that names `name` shows the field message, not "try again"', async () => {
      mockShifts();
      server.use(
        http.post('*/routines/shifts', () =>
          HttpResponse.json(
            apiErrorBody(400, ['name must be shorter than or equal to 100 characters'], '/x'),
            { status: 400 },
          ),
        ),
      );
      renderPanel();
      const user = userEvent.setup();
      await user.click(await screen.findByRole('button', { name: 'Add shift' }));
      await user.type(await screen.findByLabelText('Name'), 'Evening');
      await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Add' }));

      expect(
        await screen.findByText("This name isn't valid. Check it and try again."),
      ).toBeTruthy();
      expect(screen.queryByText("Couldn't add the shift. Try again.")).toBeNull();
    });
  });

  describe('edit [2894]', () => {
    it('Edit prefills name and times, and saving PATCHes without a sequence', async () => {
      mockShifts();
      let patched: unknown = null;
      server.use(
        http.patch('*/routines/shifts/shift-1', async ({ request }) => {
          patched = await request.json();
          return HttpResponse.json({ ...SHIFT, name: 'Day' });
        }),
      );
      renderPanel();
      const user = userEvent.setup();

      await user.click(await screen.findByRole('button', { name: 'Edit' }));
      const name = await screen.findByDisplayValue('Morning');
      await user.clear(name);
      await user.type(name, 'Day');
      await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Save' }));

      await waitFor(() =>
        expect(patched).toEqual({ name: 'Day', day_starts_at: '08:00', day_ends_at: '13:00' }),
      );
      await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    });

    it('a 409 SHIFT_PERIODS_OUTSIDE_WINDOW shows the translated sentence', async () => {
      mockShifts();
      server.use(
        http.patch('*/routines/shifts/shift-1', () =>
          HttpResponse.json(
            {
              statusCode: 409,
              message: 'Some periods fall outside the new day times',
              details: { code: 'SHIFT_PERIODS_OUTSIDE_WINDOW' },
              timestamp: new Date().toISOString(),
              path: '/routines/shifts/shift-1',
              requestId: 'req-1',
            },
            { status: 409 },
          ),
        ),
      );
      renderPanel();
      const user = userEvent.setup();

      await user.click(await screen.findByRole('button', { name: 'Edit' }));
      await user.click(
        within(await screen.findByRole('dialog')).getByRole('button', { name: 'Save' }),
      );

      expect(
        await screen.findByText(
          'Some periods of this shift fall outside these times. Change the period times first.',
        ),
      ).toBeTruthy();
    });
  });
});

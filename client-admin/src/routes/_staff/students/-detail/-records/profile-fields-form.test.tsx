import { cleanupTestState, renderWithProviders, server, studentFactory } from '@biddaloy/ui/test';
import { screen, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { afterEach, describe, expect, it } from 'vitest';

import { ProfileFieldsForm } from './profile-fields-form';

/** Dirty-preserving seeding: a background refetch must not erase unsaved typing. */
describe('students/-detail/-records/profile-fields-form', () => {
  afterEach(async () => {
    await cleanupTestState();
  });

  const base = {
    id: 'student-1',
    religion: 'Islam',
    birth_reg_no: '1234',
    father_name: 'Karim',
    mother_name: 'Amina',
    health_notes: 'Asthma',
    updated_at: '2026-01-01T00:00:00.000Z',
  };
  const render = (over: Record<string, unknown> = base) =>
    renderWithProviders(<ProfileFieldsForm student={studentFactory(over)} />, {
      tenantId: 'tenant-1',
      role: 'ADMIN',
      locale: 'en',
    });
  const rerenderWith = (
    rerender: (ui: React.ReactElement) => void,
    over: Record<string, unknown>,
  ) => rerender(<ProfileFieldsForm student={studentFactory(over)} />);

  it('keeps a typed field and updates untouched fields when newer server data arrives', async () => {
    const { user, rerender } = render();
    const religion = await screen.findByLabelText<HTMLInputElement>('Religion');
    await user.clear(religion);
    await user.type(religion, 'Hindu');

    rerenderWith(rerender, {
      ...base,
      religion: 'Buddhist',
      father_name: 'Rahim',
      updated_at: '2026-01-02T00:00:00.000Z',
    });

    await waitFor(() =>
      expect(screen.getByLabelText<HTMLInputElement>("Father's name").value).toBe('Rahim'),
    );
    expect(screen.getByLabelText<HTMLInputElement>('Religion').value).toBe('Hindu');
  });

  it('reflects saved values and is not dirty after a successful save', async () => {
    server.use(
      http.patch('/api/v1/students/:id/records', async ({ request }) =>
        HttpResponse.json({ ...base, ...((await request.json()) as object) }),
      ),
    );
    const { user, rerender } = render();
    const religion = await screen.findByLabelText<HTMLInputElement>('Religion');
    await user.clear(religion);
    await user.type(religion, '  Hindu  ');
    await user.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(religion.value).toBe('Hindu'));

    // Not dirty: the server echoing a different value later now overwrites it.
    rerenderWith(rerender, {
      ...base,
      religion: 'Buddhist',
      updated_at: '2026-01-03T00:00:00.000Z',
    });
    await waitFor(() => expect(religion.value).toBe('Buddhist'));
  });

  it('reseeds everything when the student changes', async () => {
    const { user, rerender } = render();
    const religion = await screen.findByLabelText<HTMLInputElement>('Religion');
    await user.clear(religion);
    await user.type(religion, 'Hindu');

    rerenderWith(rerender, { ...base, id: 'student-2', religion: 'Christian' });

    await waitFor(() =>
      expect(screen.getByLabelText<HTMLInputElement>('Religion').value).toBe('Christian'),
    );
  });
});

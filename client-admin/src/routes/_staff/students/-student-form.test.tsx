import {
  classFactory,
  classSectionFactory,
  cleanupTestState,
  renderWithRouter,
  server,
  studentFactory,
  userEvent,
} from '@biddaloy/ui/test';
import { screen, waitFor, within } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { afterEach, describe, expect, it } from 'vitest';

import { routeTree } from '../../../routeTree.gen';

/** [59.G3] Photo-consent field on the edit form, through the real route tree (needs a router). */
const ID = '3fa85f64-5717-4562-b3fc-2c963f66afa6';

function setup(photoKey: string | null, consent: 'GIVEN' | 'REFUSED' | 'UNKNOWN' = 'GIVEN') {
  const klass = classFactory({ id: 'class-1', name: 'Class 5' });
  const section = classSectionFactory({ id: 'section-1', class_id: 'class-1' });
  const student = studentFactory({
    id: ID,
    photo_key: photoKey,
    photo_consent: consent,
    class_section_id: 'section-1',
    class_section: { ...section, class_id: 'class-1' },
    guardians: [],
  });
  const patched: unknown[] = [];
  server.use(
    http.get('/api/v1/classes', () =>
      HttpResponse.json({ data: [klass], total: 1, page: 1, limit: 100, totalPages: 1 }),
    ),
    http.get(`/api/v1/students/${ID}`, () => HttpResponse.json(student)),
    http.patch(`/api/v1/students/${ID}`, async ({ request }) => {
      patched.push(await request.json());
      return HttpResponse.json(student);
    }),
  );
  renderWithRouter(routeTree, {
    initialEntries: [`/students/${ID}/edit`],
    tenantId: 'tenant-1',
    role: 'ADMIN',
    locale: 'en',
  });
  return { patched, user: userEvent.setup() };
}

async function choose(user: ReturnType<typeof userEvent.setup>, label: string) {
  await user.click(await screen.findByRole('combobox', { name: 'Photo consent' }));
  await user.click(await screen.findByRole('option', { name: label }));
}

describe('student form: photo consent', () => {
  afterEach(async () => {
    await cleanupTestState();
  });

  it('REFUSED on a student with a photo asks first; cancel keeps the old value', async () => {
    const { user, patched } = setup('photos/a.jpg');
    await choose(user, 'Refused');
    expect(await screen.findByText('The photo will be deleted')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.queryByText('The photo will be deleted')).toBeNull());
    expect(screen.getByRole('combobox', { name: 'Photo consent' }).textContent).toContain('Given');
    expect(patched).toEqual([]);
  });

  it('confirming sets REFUSED and saves it', async () => {
    const { user, patched } = setup('photos/a.jpg');
    await choose(user, 'Refused');
    await user.click(await screen.findByRole('button', { name: 'Delete photo' }));
    await within(screen.getByRole('combobox', { name: 'Photo consent' })).findByText('Refused');
    await user.click(screen.getByRole('button', { name: 'Save changes' }));
    await waitFor(() => expect(patched).toEqual([{ photo_consent: 'REFUSED' }]));
  });

  it('REFUSED on a student without a photo needs no confirm', async () => {
    const { user } = setup(null);
    await choose(user, 'Refused');
    expect(screen.queryByText('The photo will be deleted')).toBeNull();
    expect(screen.getByRole('combobox', { name: 'Photo consent' }).textContent).toContain(
      'Refused',
    );
  });
});

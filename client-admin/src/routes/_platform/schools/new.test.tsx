import { UserRole } from '@biddaloy/shared';
import { cleanupTestState, renderWithRouter, server } from '@biddaloy/ui/test';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { afterEach, describe, expect, it } from 'vitest';

import { routeTree } from '../../../routeTree.gen';

/** [31.4.platform-1] `/schools/new` as a full-page modal: step list, footer
 * buttons that submit the step forms, translated validation, discard prompt. */
describe('/schools/new', () => {
  afterEach(async () => {
    await cleanupTestState();
  });

  function renderNew() {
    renderWithRouter(routeTree, {
      initialEntries: ['/schools/new'],
      tenantId: 'tenant-1',
      role: UserRole.SUPER_ADMIN,
      locale: 'en',
    });
  }

  async function fillSchool(user: ReturnType<typeof userEvent.setup>) {
    await user.type(await screen.findByLabelText(/School name/), 'Ananta School');
  }

  async function goToAdminStep(user: ReturnType<typeof userEvent.setup>) {
    await fillSchool(user);
    await user.click(screen.getByRole('button', { name: 'Next' }));
    await screen.findByLabelText(/Admin name/);
  }

  it('shows the title, the step list with step 1 current, and a Close button', async () => {
    renderNew();

    expect(await screen.findByRole('heading', { name: 'New school', level: 1 })).toBeTruthy();
    const steps = screen.getByRole('list', { name: 'Steps' });
    const items = within(steps).getAllByRole('listitem', { hidden: false });
    expect(items[0]?.getAttribute('aria-current')).toBe('step');
    expect(items[1]?.getAttribute('aria-current')).toBeNull();
    expect(screen.getByRole('button', { name: 'Close' })).toBeTruthy();
  });

  it('an empty submit shows the translated required message', async () => {
    const user = userEvent.setup();
    renderNew();
    await screen.findByLabelText(/School name/);

    await user.click(screen.getByRole('button', { name: 'Next' }));

    expect((await screen.findAllByText('Fill this in.')).length).toBeGreaterThan(0);
  });

  it('an invalid link name shows the pattern message', async () => {
    const user = userEvent.setup();
    renderNew();
    await fillSchool(user);
    const slug = screen.getByLabelText(/Link name/);
    await user.clear(slug);
    await user.type(slug, 'Bad Slug!');
    await user.click(screen.getByRole('button', { name: 'Next' }));

    expect(
      await screen.findByText('Use only lowercase English letters, numbers and single hyphens.'),
    ).toBeTruthy();
  });

  it('Next moves to step 2; neither email nor phone shows the contact message', async () => {
    const user = userEvent.setup();
    renderNew();
    await goToAdminStep(user);

    const items = within(screen.getByRole('list', { name: 'Steps' })).getAllByRole('listitem');
    expect(items[1]?.getAttribute('aria-current')).toBe('step');

    await user.type(screen.getByLabelText(/Admin name/), 'Rahim');
    await user.click(screen.getByRole('button', { name: 'Create school' }));

    expect((await screen.findAllByText('Give an email or a phone number.')).length).toBe(2);
  });

  it('a 409 returns to step 1 with the conflict on the link name', async () => {
    server.use(
      http.post('/api/v1/schools', () =>
        HttpResponse.json(
          {
            statusCode: 409,
            message: 'Conflict',
            timestamp: new Date().toISOString(),
            path: '/api/v1/schools',
            requestId: 'r1',
          },
          { status: 409 },
        ),
      ),
    );
    const user = userEvent.setup();
    renderNew();
    await goToAdminStep(user);
    await user.type(screen.getByLabelText(/Admin name/), 'Rahim');
    await user.type(screen.getByLabelText('Email'), 'rahim@example.com');
    await user.click(screen.getByRole('button', { name: 'Create school' }));

    expect(await screen.findByText('This link name is already taken.')).toBeTruthy();
    expect(screen.getByLabelText(/School name/)).toBeTruthy();
  });

  it('success shows the invitation badge and a "View school" button', async () => {
    server.use(
      http.post('/api/v1/schools', () =>
        HttpResponse.json(
          {
            school: { id: 'school-new', slug: 'ananta-school', status: 'ACTIVE' },
            admin: { user_id: 'user-1', existed: false },
            invitation: { id: 'inv-1', status: 'PENDING' },
          },
          { status: 201 },
        ),
      ),
    );
    const user = userEvent.setup();
    renderNew();
    await goToAdminStep(user);
    await user.type(screen.getByLabelText(/Admin name/), 'Rahim');
    await user.type(screen.getByLabelText('Email'), 'rahim@example.com');
    await user.click(screen.getByRole('button', { name: 'Create school' }));

    expect(await screen.findByRole('heading', { name: 'School created' })).toBeTruthy();
    // The badge carries a translated label, never the raw enum.
    expect(screen.queryByText('PENDING')).toBeNull();
    expect(screen.getByRole('button', { name: 'View school' })).toBeTruthy();
  });

  it('Cancel with typed values asks before leaving; keeping stays on the page', async () => {
    const user = userEvent.setup();
    renderNew();
    await fillSchool(user);

    await user.click(screen.getByRole('button', { name: 'Cancel' }));

    const dialog = await screen.findByRole('alertdialog');
    await user.click(within(dialog).getByRole('button', { name: /keep editing/i }));
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
    expect(screen.getByRole('heading', { name: 'New school', level: 1 })).toBeTruthy();
  });
});

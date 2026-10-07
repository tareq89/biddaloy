import {
  cleanupTestState,
  guardianFactory,
  renderWithRouter,
  server,
  studentFactory,
  userEvent,
} from '@biddaloy/ui/test';
import { screen, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { afterEach, describe, expect, it } from 'vitest';

import { routeTree } from '../../../routeTree.gen';

describe('/students/$studentId/edit', () => {
  afterEach(async () => {
    await cleanupTestState();
  });

  it('prefills the form from the existing student and their linked guardians', async () => {
    const guardian = guardianFactory({ id: 'guardian-1', full_name: 'Karim Rahman' });
    const student = studentFactory({
      id: 'student-1',
      full_name: 'Rahim Uddin',
      roll_number: 7,
      guardians: [guardian],
    });
    server.use(http.get('/api/v1/students/:id', () => HttpResponse.json(student)));

    renderWithRouter(routeTree, {
      initialEntries: ['/students/student-1/edit'],
      tenantId: 'tenant-1',
      role: 'ADMIN',
      locale: 'en',
    });

    expect(await screen.findByDisplayValue('Rahim Uddin')).toBeTruthy();
    expect(screen.getByDisplayValue('7')).toBeTruthy();
    const selected = screen.getByRole('list', { name: 'Linked guardians' });
    expect(selected.textContent).toContain('Karim Rahman');
  });

  it('submits a PATCH and navigates back to the detail page on success', async () => {
    const student = studentFactory({ id: 'student-1', full_name: 'Rahim Uddin', guardians: [] });
    let patchBody: unknown;
    server.use(
      http.get('/api/v1/students/:id', () => HttpResponse.json(student)),
      http.patch('/api/v1/students/:id', async ({ request }) => {
        patchBody = await request.json();
        return HttpResponse.json({ ...student, full_name: 'Rahim Uddin Khan' });
      }),
    );

    const { router } = renderWithRouter(routeTree, {
      initialEntries: ['/students/student-1/edit'],
      tenantId: 'tenant-1',
      role: 'ADMIN',
      locale: 'en',
    });

    const fullName = await screen.findByDisplayValue('Rahim Uddin');
    const user = userEvent.setup();
    await user.clear(fullName);
    await user.type(fullName, 'Rahim Uddin Khan');
    await user.click(screen.getByRole('button', { name: 'Save changes' }));

    await waitFor(() => expect(router.state.location.pathname).toBe('/students/student-1'));
    expect(patchBody).toMatchObject({ full_name: 'Rahim Uddin Khan' });
  });

  it('keeps an old free-text gender selected so saving does not lose it', async () => {
    const student = studentFactory({
      id: 'student-1',
      full_name: 'Rahim Uddin',
      gender: 'Male (legacy)',
      guardians: [],
    });
    let patchBody: Record<string, unknown> = {};
    server.use(
      http.get('/api/v1/students/:id', () => HttpResponse.json(student)),
      http.patch('/api/v1/students/:id', async ({ request }) => {
        patchBody = (await request.json()) as Record<string, unknown>;
        return HttpResponse.json(student);
      }),
    );

    renderWithRouter(routeTree, {
      initialEntries: ['/students/student-1/edit'],
      tenantId: 'tenant-1',
      role: 'ADMIN',
      locale: 'en',
    });

    const gender = await screen.findByRole('combobox', { name: 'Gender' });
    expect(gender.textContent).toContain('Male (legacy)');
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Save changes' }));
    await waitFor(() => expect(patchBody).toMatchObject({ gender: 'Male (legacy)' }));
  });

  it('renders the error state inside the full-page frame', async () => {
    server.use(http.get('/api/v1/students/:id', () => new HttpResponse(null, { status: 404 })));

    renderWithRouter(routeTree, {
      initialEntries: ['/students/student-1/edit'],
      tenantId: 'tenant-1',
      role: 'ADMIN',
      locale: 'en',
    });

    expect(await screen.findByRole('heading', { name: 'Edit student' })).toBeTruthy();
    expect(await screen.findByRole('button', { name: 'Close' })).toBeTruthy();
  });

  it('is axe clean', async () => {
    const student = studentFactory({ id: 'student-1', guardians: [] });
    server.use(http.get('/api/v1/students/:id', () => HttpResponse.json(student)));

    const { container } = renderWithRouter(routeTree, {
      initialEntries: ['/students/student-1/edit'],
      tenantId: 'tenant-1',
      role: 'ADMIN',
      locale: 'en',
    });

    await screen.findByDisplayValue(student.full_name);
    await expect(container).toHaveNoViolations();
  });
});

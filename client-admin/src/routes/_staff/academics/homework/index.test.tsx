import { HomeworkGradingMode } from '@biddaloy/shared';
import {
  classFactory,
  cleanupTestState,
  renderWithRouter,
  server,
  subjectFactory,
} from '@biddaloy/ui/test';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { afterEach, describe, expect, it } from 'vitest';

import { routeTree } from '../../../../routeTree.gen';

describe('/academics/homework', () => {
  afterEach(async () => {
    await cleanupTestState();
  });

  it('renders rows with subject/class names resolved from /classes and /subjects', async () => {
    const klass = classFactory({ id: 'class-1', name: 'Class 6' });
    const subject = subjectFactory({ id: 'subject-1', name_en: 'Mathematics' });

    server.use(
      http.get('/api/v1/homework', () =>
        HttpResponse.json([
          {
            id: 'hw-1',
            subject_id: subject.id,
            class_id: klass.id,
            title: 'Algebra worksheet',
            description: null,
            grading_mode: HomeworkGradingMode.TICK,
            attachments: [],
            created_at: '2026-09-01T00:00:00.000Z',
          },
        ]),
      ),
      http.get('/api/v1/classes', () =>
        HttpResponse.json({ data: [klass], total: 1, page: 1, limit: 100, totalPages: 1 }),
      ),
      http.get('/api/v1/subjects', () =>
        HttpResponse.json({ data: [subject], total: 1, page: 1, limit: 100, totalPages: 1 }),
      ),
    );

    renderWithRouter(routeTree, {
      initialEntries: ['/academics/homework'],
      tenantId: 'tenant-1',
      role: 'ADMIN',
      locale: 'en',
    });

    await screen.findByText('Algebra worksheet');
    expect(await screen.findByText('Mathematics')).toBeTruthy();
    expect(screen.getByText('Class 6')).toBeTruthy();
  });

  it('picking a class filter sends class_id on the next /homework request', async () => {
    const klass = classFactory({ id: 'class-1', name: 'Class 6' });
    const requestedUrls: string[] = [];

    server.use(
      http.get('/api/v1/homework', ({ request }) => {
        requestedUrls.push(request.url);
        return HttpResponse.json([]);
      }),
      http.get('/api/v1/classes', () =>
        HttpResponse.json({ data: [klass], total: 1, page: 1, limit: 100, totalPages: 1 }),
      ),
      http.get('/api/v1/subjects', () =>
        HttpResponse.json({ data: [], total: 0, page: 1, limit: 100, totalPages: 1 }),
      ),
    );

    renderWithRouter(routeTree, {
      initialEntries: ['/academics/homework'],
      tenantId: 'tenant-1',
      role: 'ADMIN',
      locale: 'en',
    });

    await screen.findByText('No homework found.');
    const user = userEvent.setup();
    await user.click(screen.getByLabelText('Class'));
    await user.click(await screen.findByRole('option', { name: 'Class 6' }));

    await waitFor(() =>
      expect(requestedUrls.some((url) => url.includes('class_id=class-1'))).toBe(true),
    );
  });

  it('empty array renders the empty message', async () => {
    server.use(
      http.get('/api/v1/homework', () => HttpResponse.json([])),
      http.get('/api/v1/classes', () =>
        HttpResponse.json({ data: [], total: 0, page: 1, limit: 100, totalPages: 1 }),
      ),
      http.get('/api/v1/subjects', () =>
        HttpResponse.json({ data: [], total: 0, page: 1, limit: 100, totalPages: 1 }),
      ),
    );

    renderWithRouter(routeTree, {
      initialEntries: ['/academics/homework'],
      tenantId: 'tenant-1',
      role: 'ADMIN',
      locale: 'en',
    });

    expect(await screen.findByText('No homework found.')).toBeTruthy();
  });

  it('shows "Assign homework" for TEACHER, who holds HOMEWORK_ASSIGN', async () => {
    server.use(
      http.get('/api/v1/homework', () => HttpResponse.json([])),
      http.get('/api/v1/classes', () =>
        HttpResponse.json({ data: [], total: 0, page: 1, limit: 100, totalPages: 1 }),
      ),
      http.get('/api/v1/subjects', () =>
        HttpResponse.json({ data: [], total: 0, page: 1, limit: 100, totalPages: 1 }),
      ),
    );

    renderWithRouter(routeTree, {
      initialEntries: ['/academics/homework'],
      tenantId: 'tenant-1',
      role: 'TEACHER',
      locale: 'en',
    });

    expect(await screen.findByRole('link', { name: 'Assign homework' })).toBeTruthy();
  });

  it('refuses the whole route for ACCOUNTANT, who lacks HOMEWORK_READ', async () => {
    renderWithRouter(routeTree, {
      initialEntries: ['/academics/homework'],
      tenantId: 'tenant-1',
      role: 'ACCOUNTANT',
      locale: 'en',
    });

    expect(await screen.findByText("You don't have access to this page.")).toBeTruthy();
    expect(screen.queryByRole('heading', { name: 'Homework' })).toBeNull();
  });
});

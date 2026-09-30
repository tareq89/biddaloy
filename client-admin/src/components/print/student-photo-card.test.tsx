import { cleanupTestState, renderWithProviders, server, studentFactory } from '@biddaloy/ui/test';
import { screen, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { StudentPhotoCard } from './student-photo-card';

const student = (photoKey: string | null) =>
  studentFactory({ id: 'st-1', full_name: 'Rahim Ahmed', photo_key: photoKey });

const render = (canEdit = true) =>
  renderWithProviders(<StudentPhotoCard studentId="st-1" canEdit={canEdit} />, {
    locale: 'en',
    role: 'ADMIN',
    tenantId: 'school-1',
  });

describe('StudentPhotoCard', () => {
  beforeEach(() => {
    // jsdom has no object URLs.
    URL.createObjectURL = vi.fn(() => 'blob:photo');
    URL.revokeObjectURL = vi.fn();
  });

  afterEach(async () => {
    await cleanupTestState();
  });

  it('shows initials and asks for no photo when the student has none', async () => {
    let photoRequests = 0;
    server.use(
      http.get('/api/v1/students/st-1', () => HttpResponse.json(student(null))),
      http.get('/api/v1/students/st-1/photo', () => {
        photoRequests += 1;
        return new HttpResponse(null, { status: 404 });
      }),
    );
    render();

    await waitFor(() => expect(screen.getByText('RA')).toBeTruthy());
    expect(screen.queryByRole('img')).toBeNull();
    expect(screen.getByRole('button', { name: 'Upload photo' })).toBeTruthy();
    expect(photoRequests).toBe(0); // nothing to fetch, so no request
  });

  it('shows the photo when there is one, and offers Replace', async () => {
    server.use(
      http.get('/api/v1/students/st-1', () => HttpResponse.json(student('tenants/t/photo.jpg'))),
      http.get('/api/v1/students/st-1/photo', () =>
        HttpResponse.arrayBuffer(new Uint8Array([1, 2, 3]).buffer, {
          headers: { 'Content-Type': 'image/jpeg' },
        }),
      ),
    );
    render();

    const img = await screen.findByRole('img');
    expect(img.getAttribute('alt')).toBe('Photo of Rahim Ahmed');
    expect(screen.getByRole('button', { name: 'Replace photo' })).toBeTruthy();
  });

  it('uploads the chosen file', async () => {
    let posted = 0;
    server.use(
      http.get('/api/v1/students/st-1', () => HttpResponse.json(student(null))),
      http.post('/api/v1/students/st-1/photo', () => {
        posted += 1;
        return HttpResponse.json({ photo: true }, { status: 201 });
      }),
    );
    const { user, container } = render();
    await waitFor(() => expect(screen.getByText('RA')).toBeTruthy());

    const input = container.querySelector('input[type="file"]')!;
    await user.upload(input as HTMLInputElement, new File(['x'], 'me.jpg', { type: 'image/jpeg' }));

    await waitFor(() => expect(posted).toBe(1));
  });

  it('refuses a photo over 8 MB without sending it', async () => {
    let posted = 0;
    server.use(
      http.get('/api/v1/students/st-1', () => HttpResponse.json(student(null))),
      http.post('/api/v1/students/st-1/photo', () => {
        posted += 1;
        return HttpResponse.json({ photo: true });
      }),
    );
    const { user, container } = render();
    await waitFor(() => expect(screen.getByText('RA')).toBeTruthy());

    const big = new File([new Uint8Array(8 * 1024 * 1024 + 1)], 'big.jpg', { type: 'image/jpeg' });
    await user.upload(container.querySelector('input[type="file"]') as HTMLInputElement, big);

    expect(await screen.findByRole('alert')).toBeTruthy();
    expect(posted).toBe(0);
  });

  it('hides the upload control when the caller cannot edit', async () => {
    server.use(http.get('/api/v1/students/st-1', () => HttpResponse.json(student(null))));
    render(false);

    await waitFor(() => expect(screen.getByText('RA')).toBeTruthy());
    expect(screen.queryByRole('button', { name: 'Upload photo' })).toBeNull();
    expect(screen.queryByText(/passport-style/)).toBeNull();
  });
});

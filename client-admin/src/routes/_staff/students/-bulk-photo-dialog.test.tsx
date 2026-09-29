import { cleanupTestState, renderWithProviders, server } from '@biddaloy/ui/test';
import { screen, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { BulkPhotoDialog } from './-bulk-photo-dialog';

const render = () =>
  renderWithProviders(<BulkPhotoDialog open onOpenChange={() => undefined} />, {
    locale: 'en',
    role: 'ADMIN',
    tenantId: 'school-1',
  });

const photos = (n: number) =>
  Array.from({ length: n }, (_, i) => new File(['x'], `R-${i}.jpg`, { type: 'image/jpeg' }));

describe('BulkPhotoDialog', () => {
  afterEach(async () => {
    vi.restoreAllMocks();
    await cleanupTestState();
  });

  it('sends 30 photos as two requests (25 + 5) and reports matched / unmatched / invalid', async () => {
    // jsdom + MSW can't parse multipart (see bulk-upload.test.tsx): record what each request appended.
    const appended: string[] = [];
    vi.spyOn(FormData.prototype, 'append').mockImplementation(function (
      this: FormData,
      name: string,
      value: unknown,
    ) {
      if (name === 'files') appended.push((value as File).name);
    });
    const sizes: number[] = [];
    server.use(
      http.post('/api/v1/students/photos/bulk', () => {
        const sent = sizes.reduce((a, b) => a + b, 0);
        sizes.push(appended.length - sent);
        const first = sizes.length === 1;
        return HttpResponse.json({
          matched: first ? [{ file: 'R-0.jpg', student_id: 's-0', full_name: 'Rahim Ahmed' }] : [],
          unmatched: first ? ['R-1.jpg'] : [],
          invalid: first ? [] : [{ file: 'R-29.jpg', reason: 'Not an image' }],
        });
      }),
    );
    const { user } = render();

    await user.upload(await screen.findByTestId('photos-input'), photos(30));
    expect(screen.getByText('30 photos selected')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: /Upload 30 photos/ }));

    await waitFor(() => expect(screen.getByText('Finished')).toBeTruthy());
    expect(sizes).toEqual([25, 5]);

    // Matched is shown first, with the student's name.
    expect(screen.getByText('R-0.jpg → Rahim Ahmed')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: /No matching student \(1\)/ }));
    expect(screen.getByText('R-1.jpg')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: /Couldn't read \(1\)/ }));
    expect(screen.getByText('R-29.jpg: Not an image')).toBeTruthy();
  });

  it('keeps only image files when a whole folder is picked', async () => {
    const { user } = render();
    const mixed = [
      new File(['x'], '2024-0153.jpg', { type: 'image/jpeg' }),
      new File(['x'], 'notes.txt', { type: 'text/plain' }),
      new File(['x'], '.DS_Store', { type: '' }),
    ];
    await user.upload(await screen.findByTestId('folder-input'), mixed);

    expect(screen.getByText('1 photos selected')).toBeTruthy();
  });

  it('tells the user how to name the files', async () => {
    render();
    expect(await screen.findByText(/registration number, for example 2024-0153\.jpg/)).toBeTruthy();
  });

  it('shows an error when the upload stops', async () => {
    server.use(
      http.post('/api/v1/students/photos/bulk', () =>
        HttpResponse.json({ message: 'boom' }, { status: 400 }),
      ),
    );
    const { user } = render();
    await user.upload(await screen.findByTestId('photos-input'), photos(2));
    await user.click(screen.getByRole('button', { name: /Upload 2 photos/ }));

    expect(await screen.findByRole('alert')).toBeTruthy();
  });
});

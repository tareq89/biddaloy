import { File as NodeFile } from 'node:buffer';

import { cleanupTestState, renderWithProviders, server } from '@biddaloy/ui/test';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { afterEach, describe, expect, it } from 'vitest';

import { HrRecordDocumentsSection } from './hr-record-documents-section';

/** node:buffer's `File`, not jsdom's — jsdom 30's Blob hangs MSW's XHR
 * body serialization (see homework/import.test.tsx's same note). */
function makeFile(name: string, content = 'bytes', type = 'image/png'): File {
  return new NodeFile([content], name, { type }) as File;
}

afterEach(async () => {
  await cleanupTestState();
});

describe('HrRecordDocumentsSection', () => {
  it('shows an empty state per document type when none are uploaded', async () => {
    server.use(http.get('/api/v1/staff-documents/user-1', () => HttpResponse.json([])));

    renderWithProviders(<HrRecordDocumentsSection userId="user-1" />, {
      locale: 'en',
      tenantId: 'tenant-1',
      role: 'ADMIN',
    });

    expect((await screen.findAllByText('Not uploaded yet')).length).toBe(4);
    expect(screen.getByText('National ID')).toBeTruthy();
    expect(screen.getByText('Birth certificate')).toBeTruthy();
    expect(screen.getByText('Photo')).toBeTruthy();
    expect(screen.getByText('Other document')).toBeTruthy();
  });

  it('shows the current file as a download link when one exists', async () => {
    server.use(
      http.get('/api/v1/staff-documents/user-1', () =>
        HttpResponse.json([
          {
            id: 'doc-1',
            staff_user_id: 'user-1',
            document_type: 'NID',
            original_filename: 'nid-card.png',
            content_type: 'image/png',
            created_at: '2026-01-01T00:00:00.000Z',
            updated_at: '2026-01-01T00:00:00.000Z',
          },
        ]),
      ),
    );

    renderWithProviders(<HrRecordDocumentsSection userId="user-1" />, {
      locale: 'en',
      tenantId: 'tenant-1',
      role: 'ADMIN',
    });

    expect(await screen.findByRole('button', { name: 'nid-card.png' })).toBeTruthy();
    expect((await screen.findAllByText('Not uploaded yet')).length).toBe(3);
  });

  it('uploads a file to the right document_type endpoint', async () => {
    server.use(http.get('/api/v1/staff-documents/user-1', () => HttpResponse.json([])));
    let uploadedType: string | undefined;
    server.use(
      http.post('/api/v1/staff-documents/user-1/PHOTO', ({ params }) => {
        const documentType = params['documentType' as never];
        uploadedType = typeof documentType === 'string' ? documentType : 'PHOTO';
        return HttpResponse.json(
          {
            id: 'doc-2',
            staff_user_id: 'user-1',
            document_type: 'PHOTO',
            original_filename: 'photo.png',
            content_type: 'image/png',
            created_at: '2026-01-01T00:00:00.000Z',
            updated_at: '2026-01-01T00:00:00.000Z',
          },
          { status: 201 },
        );
      }),
    );

    renderWithProviders(<HrRecordDocumentsSection userId="user-1" />, {
      locale: 'en',
      tenantId: 'tenant-1',
      role: 'ADMIN',
    });

    const user = userEvent.setup({ applyAccept: false });
    const photoUploadButtons = await screen.findAllByRole('button', { name: 'Upload' });
    // Slots render in DOCUMENT_TYPES order: NID, BIRTH_CERTIFICATE, PHOTO, OTHER.
    const photoUploadButton = photoUploadButtons[2];
    if (!photoUploadButton) throw new Error('expected a PHOTO upload button');
    await user.click(photoUploadButton);
    const input = screen.getByLabelText('Photo');
    await user.upload(input, makeFile('photo.png'));

    await waitFor(() => expect(uploadedType).toBe('PHOTO'));
  });
});

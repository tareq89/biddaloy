import '@biddaloy/ui/test';

import { cleanupTestState, renderWithProviders, server } from '@biddaloy/ui/test';
import { screen } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { StaffDocumentsTab } from './documents-tab';

const navigateMock = vi.hoisted(() => vi.fn());
vi.mock('@tanstack/react-router', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@tanstack/react-router')>();
  return { ...actual, useNavigate: () => navigateMock, useRouterState: () => '/staff/u-1' };
});
vi.mock('../../../../components/print/history/subject-print-history', () => ({
  SubjectPrintHistory: ({ subjectType, subjectId }: { subjectType: string; subjectId: string }) => (
    <div data-testid="history">{`${subjectType}:${subjectId}`}</div>
  ),
}));

const doc = (document_type: string) => ({
  id: `d-${document_type}`,
  staff_user_id: 'u-1',
  document_type,
  original_filename: 'x.jpg',
  content_type: 'image/jpeg',
  created_at: '2027-01-01T00:00:00.000Z',
  updated_at: '2027-01-01T00:00:00.000Z',
});

function setup(docs: unknown[]) {
  server.use(http.get('/api/v1/staff-documents/u-1', () => HttpResponse.json(docs)));
  const onOpenHrRecord = vi.fn();
  const view = renderWithProviders(
    <StaffDocumentsTab userId="u-1" onOpenHrRecord={onOpenHrRecord} />,
    {
      locale: 'en',
      role: 'ADMIN',
      tenantId: 'tenant-1',
    },
  );
  return { ...view, onOpenHrRecord };
}

describe('StaffDocumentsTab', () => {
  afterEach(async () => {
    navigateMock.mockClear();
    await cleanupTestState();
  });

  it('says a photo is on file when the HR record has one, and links to the HR record to change it', async () => {
    const { user, onOpenHrRecord } = setup([doc('PHOTO')]);
    expect(await screen.findByText('A photo is on file from the HR record.')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Open HR record' }));
    expect(onOpenHrRecord).toHaveBeenCalled();
  });

  it('says so when there is no photo yet', async () => {
    setup([doc('NID')]);
    expect(await screen.findByText('No photo yet. Add one in the HR record.')).toBeTruthy();
  });

  it('Print ID card opens the staff preview for this person; their history is listed', async () => {
    const { user } = setup([]);
    expect((await screen.findByTestId('history')).textContent).toBe('STAFF:u-1');
    await user.click(screen.getByRole('button', { name: 'Print ID card' }));
    expect(navigateMock).toHaveBeenCalledWith({
      to: '/print/preview',
      search: { kind: 'STAFF_ID_CARD', subject_type: 'STAFF', ids: 'u-1', from: '/staff/u-1' },
    });
  });
});

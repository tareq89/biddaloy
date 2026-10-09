import '@biddaloy/ui/test';

import { cleanupTestState, renderWithProviders, server } from '@biddaloy/ui/test';
import { screen, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { DocumentsTab } from './documents-tab';

const navigateMock = vi.hoisted(() => vi.fn());
vi.mock('@tanstack/react-router', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@tanstack/react-router')>();
  return {
    ...actual,
    useNavigate: () => navigateMock,
    useRouterState: () => '/students/s-1',
  };
});
// The photo card and the history list have their own tests; here only the tab is under test.
vi.mock('../../../../components/print/student-photo-card', () => ({
  StudentPhotoCard: ({ studentId, canEdit }: { studentId: string; canEdit: boolean }) => (
    <div data-testid="photo">{`${studentId}:${String(canEdit)}`}</div>
  ),
}));
vi.mock('../../../../components/print/history/subject-print-history', () => ({
  SubjectPrintHistory: ({ subjectType, subjectId }: { subjectType: string; subjectId: string }) => (
    <div data-testid="history">{`${subjectType}:${subjectId}`}</div>
  ),
}));

describe('student DocumentsTab', () => {
  afterEach(async () => {
    navigateMock.mockClear();
    await cleanupTestState();
  });

  it("shows the photo card and this student's print history", async () => {
    renderWithProviders(<DocumentsTab studentId="s-1" />, {
      locale: 'en',
      role: 'ADMIN',
      tenantId: 'tenant-1',
    });
    expect((await screen.findByTestId('photo')).textContent).toBe('s-1:true');
    expect(screen.getByTestId('history').textContent).toBe('STUDENT:s-1');
  });

  it('Print ID card opens the preview for just this student and returns here', async () => {
    const { user } = renderWithProviders(<DocumentsTab studentId="s-1" />, {
      locale: 'en',
      role: 'ADMIN',
      tenantId: 'tenant-1',
    });
    await user.click(await screen.findByRole('button', { name: 'Print ID card' }));
    expect(navigateMock).toHaveBeenCalledWith({
      to: '/print/preview',
      search: {
        kind: 'STUDENT_ID_CARD',
        subject_type: 'STUDENT',
        ids: 's-1',
        from: '/students/s-1',
      },
    });
  });

  it('Transcript opens /print/document for the current year and returns here', async () => {
    server.use(
      http.get('/api/v1/academic-years', () =>
        HttpResponse.json({
          data: [{ id: 'y-1', name: '2026', is_current: true }],
          total: 1,
          page: 1,
          limit: 10,
          totalPages: 1,
        }),
      ),
    );
    const { user } = renderWithProviders(<DocumentsTab studentId="s-1" />, {
      locale: 'en',
      role: 'ADMIN',
      tenantId: 'tenant-1',
    });
    const button = await screen.findByRole('button', { name: 'Print transcript' });
    await waitFor(() => expect((button as HTMLButtonElement).disabled).toBe(false));
    await user.click(button);
    expect(navigateMock).toHaveBeenCalledWith({
      to: '/print/document',
      search: {
        doc: 'transcript',
        student_id: 's-1',
        academic_year_id: 'y-1',
        from: '/students/s-1',
      },
    });
  });

  describe('[48.3.B-01] certificates', () => {
    const row = (over: object) => ({
      item_id: 'i-1',
      document_kind: 'TESTIMONIAL',
      serial: 'TSM-2026-00009',
      serial_year: 2026,
      serial_no: 9,
      copy_number: 1,
      subject_id: 's-1',
      subject_label: 'Rafi',
      class_name: null,
      issued_at: '2026-10-01T00:00:00.000Z',
      printed_by_name: null,
      revoked_at: null,
      revoke_reason: null,
      ...over,
    });
    const serve = (rows: object[]) =>
      server.use(
        http.get('/api/v1/print-history/register', () =>
          HttpResponse.json({ data: rows, total: rows.length, page: 1, limit: 50, totalPages: 1 }),
        ),
        http.get('/api/v1/academic-years', () =>
          HttpResponse.json({ data: [], total: 0, page: 1, limit: 10, totalPages: 0 }),
        ),
      );

    it('OFFICE_STAFF sees Issue certificate and the issued list; clicking sets ?issue=pick', async () => {
      serve([row({})]);
      const { user } = renderWithProviders(<DocumentsTab studentId="s-1" />, {
        locale: 'en',
        role: 'OFFICE_STAFF',
        tenantId: 'tenant-1',
      });
      expect(await screen.findByText('TSM-2026-00009')).toBeTruthy();
      await user.click(screen.getByRole('button', { name: 'Issue certificate' }));
      const arg = navigateMock.mock.calls[0]![0] as { search: (p: object) => object };
      expect(arg.search({ tab: 'documents' })).toEqual({ tab: 'documents', issue: 'pick' });
    });

    it('an ACCOUNTANT (no CERTIFICATE_ISSUE) does not see Issue certificate', async () => {
      serve([]);
      renderWithProviders(<DocumentsTab studentId="s-1" />, {
        locale: 'en',
        role: 'ACCOUNTANT',
        tenantId: 'tenant-1',
      });
      await screen.findByTestId('photo');
      expect(screen.queryByRole('button', { name: 'Issue certificate' })).toBeNull();
    });

    it('a revoked row shows the badge and the reason', async () => {
      serve([row({ revoked_at: '2026-10-02T00:00:00.000Z', revoke_reason: 'Wrong name' })]);
      renderWithProviders(<DocumentsTab studentId="s-1" />, {
        locale: 'en',
        role: 'OFFICE_STAFF',
        tenantId: 'tenant-1',
      });
      expect(await screen.findByText('Revoked')).toBeTruthy();
      expect(screen.getByText(/Wrong name/)).toBeTruthy();
    });
  });
});

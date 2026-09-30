import '@biddaloy/ui/test';

import { cleanupTestState, renderWithProviders } from '@biddaloy/ui/test';
import { screen } from '@testing-library/react';
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
});

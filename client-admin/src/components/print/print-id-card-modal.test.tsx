import '@biddaloy/ui/test';

import { cleanupTestState, renderWithProviders, server } from '@biddaloy/ui/test';
import { screen, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { PrintIdCardModal, type PrintIdCardChoice } from './print-id-card-modal';

const CLASS_ID = '11111111-1111-4111-8111-111111111111';
const SECTION_ID = '22222222-2222-4222-8222-222222222222';

let usersCalls = 0;

function serve() {
  usersCalls = 0;
  server.use(
    http.get('/api/v1/students', () =>
      HttpResponse.json({
        data: [
          { id: 'a', full_name: 'Rahim Uddin' },
          { id: 'b', full_name: 'Karim Ali' },
        ],
        total: 2,
        page: 1,
        limit: 20,
      }),
    ),
    http.get('/api/v1/users', () => {
      usersCalls += 1;
      return HttpResponse.json({
        data: [{ id: 'u1', full_name: 'Mr Teacher' }],
        total: 1,
        page: 1,
        limit: 20,
      });
    }),
    http.get('/api/v1/classes', () =>
      HttpResponse.json({
        data: [{ id: CLASS_ID, name: 'Class 6' }],
        total: 1,
        page: 1,
        limit: 100,
      }),
    ),
    http.get(`/api/v1/classes/${CLASS_ID}/sections`, () =>
      HttpResponse.json([{ id: SECTION_ID, section_name: 'A', student_count: 30 }]),
    ),
  );
}

function setup(initialType: 'STUDENT' | 'STAFF' = 'STUDENT', role = 'ADMIN') {
  serve();
  const onConfirm = vi.fn<(choice: PrintIdCardChoice) => void>();
  const onCancel = vi.fn();
  const view = renderWithProviders(
    <PrintIdCardModal open initialType={initialType} onCancel={onCancel} onConfirm={onConfirm} />,
    { locale: 'en', role, tenantId: 'tenant-1' },
  );
  return { ...view, onConfirm, onCancel };
}

describe('PrintIdCardModal', () => {
  afterEach(async () => {
    await cleanupTestState();
  });

  it('picking 2 students confirms with their ids joined', async () => {
    const { user, onConfirm } = setup();
    await user.click(await screen.findByLabelText('Rahim Uddin'));
    await user.click(screen.getByLabelText('Karim Ali'));
    await user.click(screen.getByRole('button', { name: 'Continue with 2' }));
    expect(onConfirm).toHaveBeenCalledWith({ subjectType: 'STUDENT', ids: 'a,b' });
  });

  it('picking a class section confirms with the whole section', async () => {
    const { user, onConfirm } = setup();
    await screen.findByLabelText('Rahim Uddin');
    await user.selectOptions(screen.getByLabelText('Class'), CLASS_ID);
    await user.selectOptions(await screen.findByLabelText('Section'), SECTION_ID);
    await user.click(screen.getByRole('button', { name: 'Print the whole section' }));
    expect(onConfirm).toHaveBeenCalledWith({ subjectType: 'STUDENT', classSectionId: SECTION_ID });
  });

  it('opened for students, it never asks the server for the staff list', async () => {
    setup();
    await screen.findByLabelText('Rahim Uddin');
    expect(usersCalls).toBe(0);
  });

  it('opened for staff by a role without STAFF_HR_READ, it shows students and never asks for staff', async () => {
    setup('STAFF', 'ACCOUNTANT');

    expect(await screen.findByLabelText('Rahim Uddin')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Staff' })).toBeNull();
    expect(usersCalls).toBe(0);
  });

  it('opened for staff, it lists staff and has no whole-section choice', async () => {
    const { user, onConfirm } = setup('STAFF');
    await user.click(await screen.findByLabelText('Mr Teacher'));
    expect(screen.queryByLabelText('Class')).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Continue with 1' }));
    expect(onConfirm).toHaveBeenCalledWith({ subjectType: 'STAFF', ids: 'u1' });
  });

  it('cannot continue until someone is chosen; Cancel calls onCancel', async () => {
    const { user, onCancel } = setup();
    await screen.findByLabelText('Rahim Uddin');
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Continue with 0' }).hasAttribute('disabled')).toBe(
        true,
      ),
    );
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onCancel).toHaveBeenCalled();
  });
});

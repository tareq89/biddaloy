import '@biddaloy/ui/test';

import { REGION_BD_EN, RegionConfigProvider } from '@biddaloy/ui/i18n';
import { cleanupTestState, renderWithProviders, server } from '@biddaloy/ui/test';
import { screen, waitFor, within } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import type * as React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { PrintIdCardModal, type PrintIdCardChoice } from './print-id-card-modal';

/** Digits follow the region, and the default region is Bangla: pin Latin for English assertions. */
const en = (ui: React.ReactElement) => (
  <RegionConfigProvider value={REGION_BD_EN}>{ui}</RegionConfigProvider>
);

const CLASS_ID = '11111111-1111-4111-8111-111111111111';
const SECTION_ID = '22222222-2222-4222-8222-222222222222';

let usersCalls = 0;

function serve() {
  usersCalls = 0;
  server.use(
    http.get('/api/v1/students', () =>
      HttpResponse.json({
        data: [
          { id: 'a', full_name: 'Rahim Uddin', registration_number: 'R-1' },
          { id: 'b', full_name: 'Karim Ali', registration_number: 'R-2' },
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
  const onClose = vi.fn();
  const view = renderWithProviders(
    en(<PrintIdCardModal initialType={initialType} onClose={onClose} onConfirm={onConfirm} />),
    { locale: 'en', role, tenantId: 'tenant-1' },
  );
  return { ...view, onConfirm, onClose };
}

describe('PrintIdCardModal', () => {
  afterEach(async () => {
    await cleanupTestState();
  });

  it('picking 2 students confirms with their ids joined', async () => {
    const { user, onConfirm } = setup();
    await user.click(await screen.findByRole('checkbox', { name: /Rahim Uddin/ }));
    await user.click(screen.getByRole('checkbox', { name: /Karim Ali/ }));
    expect(screen.getAllByRole('button', { name: /^Remove / })).toHaveLength(2);
    await user.click(screen.getByRole('button', { name: 'Continue with 2' }));
    expect(onConfirm).toHaveBeenCalledWith({ subjectType: 'STUDENT', ids: 'a,b' });
  });

  it('is a full-page frame: h1, a Close button, tabs, and a single filled button', async () => {
    const { user, onClose } = setup();
    await screen.findByRole('checkbox', { name: /Rahim Uddin/ });
    expect(screen.getByRole('heading', { level: 1, name: 'Print ID cards' })).toBeTruthy();
    expect(screen.getByRole('tab', { name: 'Students' })).toBeTruthy();
    expect(screen.getByRole('tab', { name: 'Staff' })).toBeTruthy();
    // Only the footer primary is filled: Close, Cancel and the rest are outline / ghost.
    expect(screen.getAllByRole('button', { name: /^Continue/ })).toHaveLength(1);
    await user.click(screen.getByRole('button', { name: 'Close' }));
    expect(onClose).toHaveBeenCalled();
  });

  it('removing a chip unticks the row', async () => {
    const { user } = setup();
    const row = await screen.findByRole('checkbox', { name: /Rahim Uddin/ });
    await user.click(row);
    expect(row.getAttribute('aria-checked')).toBe('true');
    await user.click(screen.getByRole('button', { name: 'Remove Rahim Uddin' }));
    expect(screen.getByRole('checkbox', { name: /Rahim Uddin/ }).getAttribute('aria-checked')).toBe(
      'false',
    );
  });

  it('picking a class section confirms with the whole section', async () => {
    const { user, onConfirm } = setup();
    await screen.findByRole('checkbox', { name: /Rahim Uddin/ });
    await user.click(screen.getByRole('radio', { name: /Whole section/ }));
    expect(document.querySelector('select')).toBeNull(); // no native select
    expect(screen.getAllByRole('combobox')).toHaveLength(2);
    const primary = screen.getByRole<HTMLButtonElement>('button', {
      name: 'Continue with the whole section',
    });
    expect(primary.disabled).toBe(true);
    await user.click(screen.getByRole('combobox', { name: 'Class' }));
    await user.click(await screen.findByRole('option', { name: 'Class 6' }));
    await user.click(screen.getByRole('combobox', { name: 'Section' }));
    await user.click(await screen.findByRole('option', { name: 'A' }));
    await user.click(primary);
    expect(onConfirm).toHaveBeenCalledWith({ subjectType: 'STUDENT', classSectionId: SECTION_ID });
  });

  it('opened for students, it never asks the server for the staff list', async () => {
    setup();
    await screen.findByRole('checkbox', { name: /Rahim Uddin/ });
    expect(usersCalls).toBe(0);
  });

  it('opened for staff by a role without STAFF_HR_READ, it shows students and never asks for staff', async () => {
    setup('STAFF', 'ACCOUNTANT');

    expect(await screen.findByRole('checkbox', { name: /Rahim Uddin/ })).toBeTruthy();
    expect(screen.queryByRole('tab', { name: 'Staff' })).toBeNull();
    expect(usersCalls).toBe(0);
  });

  it('opened for staff, it lists staff and has no whole-section choice', async () => {
    const { user, onConfirm } = setup('STAFF');
    await user.click(await screen.findByRole('checkbox', { name: /Mr Teacher/ }));
    expect(screen.queryByRole('radio')).toBeNull();
    expect(screen.queryByLabelText('Class')).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Continue with 1' }));
    expect(onConfirm).toHaveBeenCalledWith({ subjectType: 'STAFF', ids: 'u1' });
  });

  it('cannot continue until someone is chosen; Cancel closes when nothing is picked', async () => {
    const { user, onClose } = setup();
    await screen.findByRole('checkbox', { name: /Rahim Uddin/ });
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Continue with 0' }).hasAttribute('disabled')).toBe(
        true,
      ),
    );
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onClose).toHaveBeenCalled();
  });

  it('Cancel with people picked asks before discarding', async () => {
    const { user, onClose } = setup();
    await user.click(await screen.findByRole('checkbox', { name: /Rahim Uddin/ }));
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    const dialog = await screen.findByRole('alertdialog');
    expect(onClose).not.toHaveBeenCalled();
    await user.click(within(dialog).getByRole('button', { name: /discard/i }));
    expect(onClose).toHaveBeenCalled();
  });

  it('under bn the primary and chips use Bangla digits', async () => {
    serve();
    const view = renderWithProviders(
      <PrintIdCardModal initialType="STUDENT" onClose={vi.fn()} onConfirm={vi.fn()} />,
      { locale: 'bn', role: 'ADMIN', tenantId: 'tenant-1' },
    );
    await view.user.click(await screen.findByRole('checkbox', { name: /Rahim Uddin/ }));
    expect(screen.getByRole('button', { name: '১ জনকে নিয়ে এগিয়ে যান' })).toBeTruthy();
  });
});

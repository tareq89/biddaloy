/** Rendered directly (modal with no route of its own), like `-assign-teacher-dialog.test.tsx`. */
import {
  apiErrorBody,
  cleanupTestState,
  renderWithProviders,
  server,
  userEvent,
} from '@biddaloy/ui/test';
import { screen } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ClassFormDialog } from './-class-form-dialog';
import { DeleteSectionDialog } from './-delete-section-dialog';

describe('classes dialogs', () => {
  afterEach(async () => {
    await cleanupTestState();
  });

  it('delete-section failure is announced through a role="alert" line', async () => {
    server.use(
      http.delete('/api/v1/classes/:classId/sections/:sectionId', () =>
        HttpResponse.json(apiErrorBody(403, 'Forbidden', '/api/v1/classes/class-1/sections/section-1'), { status: 403 }),
      ),
    );
    renderWithProviders(
      <DeleteSectionDialog
        open
        onOpenChange={vi.fn()}
        classId="class-1"
        sectionId="section-1"
        sectionName="A"
        onDeleted={vi.fn()}
      />,
      { tenantId: 'tenant-1', role: 'ADMIN', locale: 'en' },
    );
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Delete' }));
    expect(await screen.findByRole('alert')).toBeTruthy();
  });

  it('a prop refetch while the class form is open does not make it dirty', async () => {
    const onOpenChange = vi.fn();
    const props = { open: true, onOpenChange, mode: 'edit' as const, classId: 'class-1', onSaved: vi.fn() };
    const view = renderWithProviders(
      <ClassFormDialog {...props} initialValues={{ name: 'Class 6', numericGrade: undefined, shift: null, version: null }} />,
      { tenantId: 'tenant-1', role: 'ADMIN', locale: 'en' },
    );
    view.rerender(<ClassFormDialog {...props} initialValues={{ name: 'Class 6 (renamed)', numericGrade: undefined, shift: null, version: null }} />);
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Cancel' }));
    // Clean close: straight through, no discard prompt.
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });
});

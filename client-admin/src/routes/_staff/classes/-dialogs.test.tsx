/** Rendered directly (modal with no route of its own), like `-assign-teacher-dialog.test.tsx`. */
import {
  apiErrorBody,
  cleanupTestState,
  renderWithProviders,
  server,
  subjectFactory,
  userEvent,
} from '@biddaloy/ui/test';
import { screen } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { AttachSubjectDialog } from './-attach-subject-dialog';
import { ClassFormDialog } from './-class-form-dialog';
import { DeleteSectionDialog } from './-delete-section-dialog';

describe('classes dialogs', () => {
  afterEach(async () => {
    await cleanupTestState();
  });

  it('delete-section failure is announced through a role="alert" line', async () => {
    server.use(
      http.delete('/api/v1/classes/:classId/sections/:sectionId', () =>
        HttpResponse.json(
          apiErrorBody(403, 'Forbidden', '/api/v1/classes/class-1/sections/section-1'),
          { status: 403 },
        ),
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
    const props = {
      open: true,
      onOpenChange,
      mode: 'edit' as const,
      classId: 'class-1',
      onSaved: vi.fn(),
    };
    const view = renderWithProviders(
      <ClassFormDialog
        {...props}
        initialValues={{ name: 'Class 6', numericGrade: undefined, shift: null, version: null }}
      />,
      { tenantId: 'tenant-1', role: 'ADMIN', locale: 'en' },
    );
    view.rerender(
      <ClassFormDialog
        {...props}
        initialValues={{
          name: 'Class 6 (renamed)',
          numericGrade: undefined,
          shift: null,
          version: null,
        }}
      />,
    );
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Cancel' }));
    // Clean close: straight through, no discard prompt.
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('[2886] the attach-subject picker reaches the 101st active subject (pages past the 100 cap)', async () => {
    const first = Array.from({ length: 100 }, (_, i) => ({
      ...subjectFactory({ id: `subject-${i}`, name_en: `Subject ${i}`, code: `S${i}` }),
    }));
    const last = subjectFactory({ id: 'subject-zoo', name_en: 'Zoology', code: 'ZOO' });
    server.use(
      http.get('/api/v1/subjects', ({ request }) => {
        const page = Number(new URL(request.url).searchParams.get('page') ?? '1');
        return HttpResponse.json({
          data: page === 1 ? first : [last],
          total: 101,
          page,
          limit: 100,
          totalPages: 2,
        });
      }),
    );
    renderWithProviders(
      <AttachSubjectDialog
        open
        onOpenChange={vi.fn()}
        classId="class-1"
        academicYearId="year-1"
        excludeSubjectIds={[]}
        onSaved={vi.fn()}
      />,
      { tenantId: 'tenant-1', role: 'ADMIN', locale: 'en' },
    );
    const user = userEvent.setup();
    await user.click(await screen.findByRole('combobox', { name: 'Subject' }));
    await user.keyboard('Zoo');
    expect(await screen.findByRole('option', { name: 'Zoology (ZOO)' })).toBeTruthy();
  });
});

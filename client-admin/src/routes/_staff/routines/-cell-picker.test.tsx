import { cleanupTestState, renderWithProviders, server } from '@biddaloy/ui/test';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { CellPicker } from './-cell-picker';

afterEach(async () => {
  await cleanupTestState();
});

function mockLookups() {
  server.use(
    http.get('/api/v1/subjects', () =>
      HttpResponse.json({
        data: [
          { id: 'subject-math', name_en: 'Math', name_bn: null, code: 'MATH', is_active: true },
          { id: 'subject-eng', name_en: 'English', name_bn: null, code: 'ENG', is_active: true },
        ],
        total: 2,
        page: 1,
        limit: 100,
        totalPages: 1,
      }),
    ),
    http.get('/api/v1/teachers', () =>
      HttpResponse.json({
        data: [
          { id: 'teacher-1', user: { full_name: 'Ms Nahar' } },
          { id: 'teacher-2', user: { full_name: 'Mr Karim' } },
        ],
        total: 2,
        page: 1,
        limit: 100,
        totalPages: 1,
      }),
    ),
  );
}

describe('CellPicker', () => {
  it('disables Save until a subject and at least one teacher are picked, then saves both', async () => {
    mockLookups();
    const onSave = vi.fn();
    const user = userEvent.setup();
    renderWithProviders(<CellPicker open onOpenChange={vi.fn()} onSave={onSave} />, {
      tenantId: 'tenant-1',
      locale: 'en',
    });

    await waitFor(() => expect(screen.getByText('Math')).toBeTruthy());
    expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Save' }).disabled).toBe(true);

    await user.click(screen.getByText('Math'));
    await user.click(screen.getByLabelText('Ms Nahar'));
    await user.click(screen.getByLabelText('Mr Karim'));
    expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Save' }).disabled).toBe(false);

    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(onSave).toHaveBeenCalledWith({
      subjectId: 'subject-math',
      teacherIds: ['teacher-1', 'teacher-2'],
      recurrence: 'WEEKLY',
      recurrenceOffset: 0,
    });
  });

  it('pre-filters the subject list from a type-ahead character', async () => {
    mockLookups();
    renderWithProviders(
      <CellPicker open onOpenChange={vi.fn()} onSave={vi.fn()} initialFilter="e" />,
      { tenantId: 'tenant-1', locale: 'en' },
    );

    await waitFor(() => expect(screen.getByText('English')).toBeTruthy());
    expect(screen.queryByText('Math')).toBeNull();
  });
});

import {
  cleanupTestState,
  renderWithProviders,
  server,
  studentFactory,
  userEvent,
} from '@biddaloy/ui/test';
import { screen, within } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { StudentPicker } from './-student-picker';

describe('StudentPicker', () => {
  afterEach(async () => {
    await cleanupTestState();
  });

  it('shows already-linked students from initialStudents before any search runs', async () => {
    const student = studentFactory({ id: 'student-1', full_name: 'Karim Rahman' });
    const { localeReady } = renderWithProviders(
      <StudentPicker
        selectedIds={['student-1']}
        onSelectedIdsChange={vi.fn()}
        initialStudents={[student]}
      />,
      { tenantId: 'tenant-1', locale: 'en' },
    );
    await localeReady;

    const selected = await screen.findByRole('list', { name: 'Linked students' });
    expect(within(selected).getByText('Karim Rahman')).toBeTruthy();
  });

  it('removing a linked student calls onSelectedIdsChange without it', async () => {
    const student = studentFactory({ id: 'student-1', full_name: 'Karim Rahman' });
    const onSelectedIdsChange = vi.fn();
    const { localeReady } = renderWithProviders(
      <StudentPicker
        selectedIds={['student-1']}
        onSelectedIdsChange={onSelectedIdsChange}
        initialStudents={[student]}
      />,
      { tenantId: 'tenant-1', locale: 'en' },
    );
    await localeReady;

    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Remove Karim Rahman' }));

    expect(onSelectedIdsChange).toHaveBeenCalledWith([]);
  });

  it('shows a no-results message when a search matches nothing', async () => {
    server.use(
      http.get('/api/v1/students', () =>
        HttpResponse.json({ data: [], total: 0, page: 1, limit: 10, totalPages: 1 }),
      ),
    );
    const { localeReady } = renderWithProviders(
      <StudentPicker selectedIds={[]} onSelectedIdsChange={vi.fn()} />,
      { tenantId: 'tenant-1', locale: 'en' },
    );
    await localeReady;

    const user = userEvent.setup();
    await user.type(screen.getByRole('textbox', { name: 'Search students' }), 'Nobody');

    expect(await screen.findByText('No students found.')).toBeTruthy();
  });

  it('checking a search result adds it to the selection', async () => {
    const student = studentFactory({
      id: 'student-2',
      full_name: 'Fatima Begum',
      registration_number: 'REG-0002',
    });
    server.use(
      http.get('/api/v1/students', () =>
        HttpResponse.json({ data: [student], total: 1, page: 1, limit: 10, totalPages: 1 }),
      ),
    );
    const onSelectedIdsChange = vi.fn();
    const { localeReady } = renderWithProviders(
      <StudentPicker selectedIds={[]} onSelectedIdsChange={onSelectedIdsChange} />,
      { tenantId: 'tenant-1', locale: 'en' },
    );
    await localeReady;

    const user = userEvent.setup();
    await user.type(screen.getByRole('textbox', { name: 'Search students' }), 'Fatima');
    await user.click(await screen.findByRole('checkbox', { name: /Fatima Begum/ }));

    expect(onSelectedIdsChange).toHaveBeenCalledWith(['student-2']);
  });
});

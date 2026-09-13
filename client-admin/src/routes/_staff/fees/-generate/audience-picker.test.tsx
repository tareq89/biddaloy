import { TooltipProvider } from '@biddaloy/ui/components';
import { cleanupTestState, renderWithProviders, server } from '@biddaloy/ui/test';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import type * as React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { AudiencePicker } from './audience-picker';

function renderPicker() {
  const onSelectedChange = vi.fn();
  const view = renderWithProviders(
    <TooltipProvider>
      <AudiencePicker
        academicYearId="year-1"
        selected={new Map()}
        onSelectedChange={onSelectedChange}
      />
    </TooltipProvider>,
    { tenantId: 'tenant-1', locale: 'en' },
  );
  return { ...view, onSelectedChange };
}

describe('AudiencePicker', () => {
  afterEach(async () => {
    await cleanupTestState();
  });

  it('adds every matching id to the selection on "Select all N matching"', async () => {
    server.use(
      http.get('/api/v1/students/ids', () =>
        HttpResponse.json({
          ids: Array.from({ length: 120 }, (_, i) => `student-${i}`),
          total: 120,
        }),
      ),
    );

    const user = userEvent.setup();
    const { onSelectedChange } = renderPicker();

    await user.click(await screen.findByRole('button', { name: /Select all/ }));

    await waitFor(() => expect(onSelectedChange).toHaveBeenCalled());
    const lastCallArg = onSelectedChange.mock.calls.at(-1)?.[0] as Map<string, string>;
    expect(lastCallArg.size).toBe(120);
  });

  it('does not submit the surrounding form when Enter is pressed in the search box', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn((event: React.FormEvent) => event.preventDefault());
    renderWithProviders(
      <form onSubmit={onSubmit}>
        <AudiencePicker academicYearId="year-1" selected={new Map()} onSelectedChange={vi.fn()} />
      </form>,
      { tenantId: 'tenant-1', locale: 'en' },
    );

    await user.type(await screen.findByLabelText('Search students'), 'Rahim{Enter}');
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('does not add any ids and does not crash when "select all" hits the 5000 cap (413)', async () => {
    server.use(
      http.get('/api/v1/students/ids', () =>
        HttpResponse.json({ message: 'Too many matching students' }, { status: 413 }),
      ),
    );

    const user = userEvent.setup();
    const { onSelectedChange } = renderPicker();

    await user.click(await screen.findByRole('button', { name: /Select all/ }));

    // Give the failed query a tick to settle, then confirm nothing was added.
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /Select all/ }).hasAttribute('disabled')).toBe(
        false,
      ),
    );
    expect(onSelectedChange).not.toHaveBeenCalled();
  });

  it('picking a class filters by class and reveals the section dropdown', async () => {
    let lastClassId: string | null = null;
    server.use(
      http.get('/api/v1/classes', () =>
        HttpResponse.json({
          data: [{ id: 'class-9', name: 'Class 9' }],
          total: 1,
          page: 1,
          limit: 100,
          totalPages: 1,
        }),
      ),
      http.get('/api/v1/classes/:id/sections', () =>
        HttpResponse.json([{ id: 'section-a', section_name: 'Section A', enrolled_count: 10 }]),
      ),
      http.get('/api/v1/students', ({ request }) => {
        lastClassId = new URL(request.url).searchParams.get('class_id');
        return HttpResponse.json({ data: [], total: 0, page: 1, limit: 50, totalPages: 0 });
      }),
    );

    const user = userEvent.setup();
    renderPicker();

    await user.click(await screen.findByRole('combobox', { name: 'Class' }));
    await user.click(await screen.findByRole('option', { name: 'Class 9' }));

    await waitFor(() => expect(lastClassId).toBe('class-9'));

    await screen.findByRole('combobox', { name: 'Section' });
  });

  it('toggling a student row directly adds/removes them from the selection', async () => {
    server.use(
      http.get('/api/v1/students', () =>
        HttpResponse.json({
          data: [
            { id: 'student-1', full_name: 'Direct Toggle Student', enrollment_status: 'ACTIVE' },
          ],
          total: 1,
          page: 1,
          limit: 50,
          totalPages: 1,
        }),
      ),
    );

    const user = userEvent.setup();
    const { onSelectedChange } = renderPicker();

    const checkbox = await screen.findByRole('checkbox', { name: 'Direct Toggle Student' });
    await user.click(checkbox);

    expect(onSelectedChange).toHaveBeenCalledWith(
      new Map([['student-1', 'Direct Toggle Student']]),
    );
  });

  it('picking a section filters students by section_id', async () => {
    let lastSectionId: string | null = null;
    server.use(
      http.get('/api/v1/classes', () =>
        HttpResponse.json({
          data: [{ id: 'class-9', name: 'Class 9' }],
          total: 1,
          page: 1,
          limit: 100,
          totalPages: 1,
        }),
      ),
      http.get('/api/v1/classes/:id/sections', () =>
        HttpResponse.json([{ id: 'section-a', section_name: 'Section A', enrolled_count: 10 }]),
      ),
      http.get('/api/v1/students', ({ request }) => {
        lastSectionId = new URL(request.url).searchParams.get('section_id');
        return HttpResponse.json({ data: [], total: 0, page: 1, limit: 50, totalPages: 0 });
      }),
    );

    const user = userEvent.setup();
    renderPicker();

    await user.click(await screen.findByRole('combobox', { name: 'Class' }));
    await user.click(await screen.findByRole('option', { name: 'Class 9' }));
    await user.click(await screen.findByRole('combobox', { name: 'Section' }));
    await user.click(await screen.findByRole('option', { name: 'Section A' }));

    await waitFor(() => expect(lastSectionId).toBe('section-a'));
  });

  it('unchecking an already-selected student row removes them', async () => {
    server.use(
      http.get('/api/v1/students', () =>
        HttpResponse.json({
          data: [{ id: 'student-1', full_name: 'Selected Student', enrollment_status: 'ACTIVE' }],
          total: 1,
          page: 1,
          limit: 50,
          totalPages: 1,
        }),
      ),
    );

    const onSelectedChange = vi.fn();
    renderWithProviders(
      <TooltipProvider>
        <AudiencePicker
          academicYearId="year-1"
          selected={new Map([['student-1', 'Selected Student']])}
          onSelectedChange={onSelectedChange}
        />
      </TooltipProvider>,
      { tenantId: 'tenant-1', locale: 'en' },
    );

    const user = userEvent.setup();
    const checkbox = await screen.findByRole('checkbox', { name: 'Selected Student' });
    await user.click(checkbox);

    expect(onSelectedChange).toHaveBeenCalledWith(new Map());
  });

  it('backfills a placeholder name once the real student page loads it', async () => {
    server.use(
      http.get('/api/v1/students', () =>
        HttpResponse.json({
          data: [{ id: 'student-1', full_name: 'Real Name', enrollment_status: 'ACTIVE' }],
          total: 1,
          page: 1,
          limit: 50,
          totalPages: 1,
        }),
      ),
    );

    const onSelectedChange = vi.fn();
    renderWithProviders(
      <TooltipProvider>
        <AudiencePicker
          academicYearId="year-1"
          selected={new Map([['student-1', 'Selected student (name loading…)']])}
          onSelectedChange={onSelectedChange}
        />
      </TooltipProvider>,
      { tenantId: 'tenant-1', locale: 'en' },
    );

    await waitFor(() =>
      expect(onSelectedChange).toHaveBeenCalledWith(new Map([['student-1', 'Real Name']])),
    );
  });

  it('shows the inactive tooltip on a non-ACTIVE student row and excludes them by default', async () => {
    server.use(
      http.get('/api/v1/students', ({ request }) => {
        const url = new URL(request.url);
        const enrollmentStatus = url.searchParams.get('enrollment_status');
        const data =
          enrollmentStatus === 'ACTIVE'
            ? [
                {
                  id: 'active-1',
                  full_name: 'Active Student',
                  enrollment_status: 'ACTIVE',
                },
              ]
            : [
                { id: 'active-1', full_name: 'Active Student', enrollment_status: 'ACTIVE' },
                {
                  id: 'inactive-1',
                  full_name: 'Inactive Student',
                  enrollment_status: 'TRANSFERRED',
                },
              ];
        return HttpResponse.json({ data, total: data.length, page: 1, limit: 50, totalPages: 1 });
      }),
    );

    const user = userEvent.setup();
    renderPicker();

    await screen.findByText('Active Student');
    expect(screen.queryByText('Inactive Student')).toBeNull();

    await user.click(screen.getByRole('checkbox', { name: 'Include inactive students' }));

    await screen.findByText('Inactive Student');
    expect(screen.getByRole('checkbox', { name: 'Inactive Student' })).toBeTruthy();
  });
});

import { cleanupTestState, renderWithProviders, server } from '@biddaloy/ui/test';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ReadmitDialog } from './readmit-dialog';

async function renderDialog(onOpenChange = vi.fn()) {
  const view = renderWithProviders(
    <ReadmitDialog open onOpenChange={onOpenChange} studentId="s1" studentName="Karim" />,
    { tenantId: 'tenant-1', locale: 'en' },
  );
  await view.localeReady;
  return { user: userEvent.setup(), onOpenChange };
}

describe('ReadmitDialog', () => {
  afterEach(async () => {
    await cleanupTestState();
  });

  it('requires a class and section', async () => {
    const { user } = await renderDialog();
    await user.click(await screen.findByRole('button', { name: 'Readmit' }));
    expect(await screen.findByText('Choose a class and section.')).toBeTruthy();
  });

  it('uses a date picker, not a native date input', async () => {
    await renderDialog();
    const dialog = await screen.findByRole('dialog');
    expect(dialog.querySelector('input[type="date"]')).toBeNull();
    expect(screen.getByRole('button', { name: 'Date' }).tagName).toBe('BUTTON');
  });

  it('is axe clean', async () => {
    await renderDialog();
    await screen.findByRole('dialog');
    await expect(document.body).toHaveNoViolations();
  });

  it('shows a server 409 inline', async () => {
    server.use(
      http.get('/api/v1/academic-years', () =>
        HttpResponse.json({
          data: [{ id: 'y1', name: '2026', is_current: true }],
          total: 1,
          page: 1,
          limit: 20,
          totalPages: 1,
        }),
      ),
      http.get('/api/v1/classes', () =>
        HttpResponse.json({
          data: [{ id: 'c1', name: 'Class 5', academic_year_id: 'y1' }],
          total: 1,
          page: 1,
          limit: 100,
          totalPages: 1,
        }),
      ),
      http.get('/api/v1/classes/c1/sections', () =>
        HttpResponse.json([{ id: 'sec1', section_name: 'A', capacity: 40, enrolled_count: 3 }]),
      ),
      http.post('/api/v1/students/s1/readmit', () =>
        HttpResponse.json(
          { statusCode: 409, message: 'Student is already active' },
          { status: 409 },
        ),
      ),
    );
    const { user } = await renderDialog();
    await user.click(await screen.findByLabelText('Class'));
    await user.click(await screen.findByRole('option', { name: 'Class 5' }));
    await user.click(screen.getByLabelText('Section'));
    await user.click(await screen.findByRole('option', { name: 'A' }));
    await user.keyboard('{Control>}{Enter}{/Control}');
    await waitFor(() => expect(screen.getAllByRole('alert').length).toBeGreaterThan(0));
    expect(screen.getByRole('dialog')).toBeTruthy();
  });
});

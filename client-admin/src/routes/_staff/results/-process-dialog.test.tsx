/**
 * [19.8.1] `ProcessDialog` — lists the still-DRAFT grids and offers
 * "Process anyway" with an explicit audit warning, per the issue's step 2.
 */
import { setActiveRole, setActiveTenant } from '@biddaloy/ui/api';
import { I18nProvider, i18n } from '@biddaloy/ui/i18n';
import { cleanupTestState, createTestQueryClient, server } from '@biddaloy/ui/test';
import { QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ProcessDialog } from './-process-dialog';

afterEach(async () => {
  await cleanupTestState();
});

async function renderDialog() {
  setActiveTenant('tenant-1');
  setActiveRole('ADMIN');
  await i18n.changeLanguage('en');
  const queryClient = createTestQueryClient();
  const onOpenChange = vi.fn();

  const view = render(
    <QueryClientProvider client={queryClient}>
      <I18nProvider>
        <ProcessDialog open onOpenChange={onOpenChange} examId="exam-1" />
      </I18nProvider>
    </QueryClientProvider>,
  );
  return { ...view, onOpenChange };
}

describe('ProcessDialog', () => {
  it('lists outstanding DRAFT grids and shows the force-audit warning', async () => {
    server.use(
      http.get('/api/v1/exams/exam-1/marks/progress', () =>
        HttpResponse.json({
          counts: { DRAFT: 1, SUBMITTED: 1 },
          outstanding: [
            {
              section_id: 'sec-1',
              section_name: 'Section A',
              subject_id: 'sub-1',
              state: 'DRAFT',
            },
          ],
        }),
      ),
    );

    await renderDialog();

    expect(await screen.findByText('Section A')).toBeTruthy();
    expect(
      screen.getByText(
        'Processing anyway includes unsubmitted grids as-is. This override is recorded in the audit log.',
      ),
    ).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Process anyway' })).toBeTruthy();
  });

  it('sends force: true when confirming with outstanding grids', async () => {
    let capturedBody: unknown;
    server.use(
      http.get('/api/v1/exams/exam-1/marks/progress', () =>
        HttpResponse.json({
          counts: { DRAFT: 1, SUBMITTED: 0 },
          outstanding: [
            {
              section_id: 'sec-1',
              section_name: 'Section A',
              subject_id: 'sub-1',
              state: 'DRAFT',
            },
          ],
        }),
      ),
      http.post('/api/v1/exams/exam-1/results/process', async ({ request }) => {
        capturedBody = await request.json();
        return HttpResponse.json({ processed: 1 });
      }),
    );

    const user = userEvent.setup();
    const { onOpenChange } = await renderDialog();

    await user.click(await screen.findByRole('button', { name: 'Process anyway' }));

    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
    expect(capturedBody).toEqual({ force: true });
  });

  it('processes without force when nothing is outstanding', async () => {
    let capturedBody: unknown;
    server.use(
      http.get('/api/v1/exams/exam-1/marks/progress', () =>
        HttpResponse.json({ counts: { DRAFT: 0, SUBMITTED: 2 }, outstanding: [] }),
      ),
      http.post('/api/v1/exams/exam-1/results/process', async ({ request }) => {
        capturedBody = await request.json();
        return HttpResponse.json({ processed: 2 });
      }),
    );

    const user = userEvent.setup();
    await renderDialog();

    await user.click(await screen.findByRole('button', { name: 'Process' }));

    await waitFor(() => expect(capturedBody).toEqual({ force: false }));
  });
});

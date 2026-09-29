import { REGION_BD_BN } from '@biddaloy/ui/i18n';
import { cleanupTestState, renderWithProviders, server } from '@biddaloy/ui/test';
import { formatCurrency, serverAmountToMinorUnits } from '@biddaloy/ui/utils';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { GenerateFinesModal } from './generate-fines-modal';

async function renderModal() {
  const onOpenChange = vi.fn();
  const view = renderWithProviders(<GenerateFinesModal open onOpenChange={onOpenChange} />, {
    tenantId: 'tenant-1',
    locale: 'en',
  });
  await view.localeReady;
  return { ...view, onOpenChange };
}

describe('GenerateFinesModal', () => {
  afterEach(async () => {
    await cleanupTestState();
  });

  it('renders the preview count and total', async () => {
    server.use(
      http.post('/api/v1/fees/fines/generate/preview', () =>
        HttpResponse.json({
          students: [
            {
              student_id: 's1',
              rule_id: 'r1',
              fee_structure_id: 'f1',
              count: 2,
              amount: 100,
              note: 'Late',
            },
          ],
          total_amount: 200,
          would_create: 1,
          duplicates: [
            {
              student_id: 's1',
              fee_structure_id: 'f1',
              existing_bill_id: 'bill-1',
              paid_amount: 0,
            },
          ],
        }),
      ),
    );

    const user = userEvent.setup();
    await renderModal();
    await user.click(await screen.findByRole('button', { name: 'Generate fines' }));

    await screen.findByText(
      `1 students, ${formatCurrency(serverAmountToMinorUnits(200, REGION_BD_BN), REGION_BD_BN)}`,
    );
  });

  it('disables confirm on a zero preview', async () => {
    server.use(
      http.post('/api/v1/fees/fines/generate/preview', () =>
        HttpResponse.json({ students: [], total_amount: 0, would_create: 0, duplicates: [] }),
      ),
    );

    const user = userEvent.setup();
    await renderModal();
    await user.click(await screen.findByRole('button', { name: 'Generate fines' }));

    await screen.findByText('No fines would be generated for this month.');
    const submitButton = screen.getByRole<HTMLButtonElement>('button', { name: 'Generate fines' });
    expect(submitButton.disabled).toBe(true);
  });

  it('sends duplicate_strategy=REMOVE_OLDER in the generate request', async () => {
    server.use(
      http.post('/api/v1/fees/fines/generate/preview', () =>
        HttpResponse.json({
          students: [
            {
              student_id: 's1',
              rule_id: 'r1',
              fee_structure_id: 'f1',
              count: 1,
              amount: 100,
              note: 'Late',
            },
          ],
          total_amount: 100,
          would_create: 1,
          duplicates: [
            {
              student_id: 's1',
              fee_structure_id: 'f1',
              existing_bill_id: 'bill-1',
              paid_amount: 0,
            },
          ],
        }),
      ),
    );

    let requestBody: unknown;
    server.use(
      http.post('/api/v1/fees/fines/generate', async ({ request }) => {
        requestBody = await request.json();
        return HttpResponse.json(
          { fee_generation_ids: ['gen-1'], generated_count: 1, skipped_count: 0 },
          { status: 201 },
        );
      }),
    );

    const user = userEvent.setup();
    await renderModal();
    await user.click(await screen.findByRole('button', { name: 'Generate fines' }));
    await screen.findByText('Some fines already exist for this month');

    await user.click(screen.getByRole('radio', { name: /Remove the older fine first/ }));
    await user.click(await screen.findByRole('button', { name: 'Generate fines' }));

    await waitFor(() => expect(requestBody).toBeTruthy());
    expect((requestBody as { duplicate_strategy: string }).duplicate_strategy).toBe('REMOVE_OLDER');
  });
});

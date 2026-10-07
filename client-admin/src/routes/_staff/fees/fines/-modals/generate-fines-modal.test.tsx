import { REGION_BD_BN } from '@biddaloy/ui/i18n';
import { cleanupTestState, renderWithProviders, server } from '@biddaloy/ui/test';
import { formatCurrency, formatNumber, serverAmountToMinorUnits } from '@biddaloy/ui/utils';
import { screen, waitFor, within } from '@testing-library/react';
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
      http.get('/api/v1/fee-structures', () =>
        HttpResponse.json({
          data: [{ id: 'f1', name: 'Late fine', amount: 100 }],
          total: 1,
          page: 1,
          limit: 100,
          totalPages: 1,
        }),
      ),
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
    await user.click(await screen.findByRole('button', { name: 'See what will be made' }));

    await screen.findByText(
      `${formatNumber(1, REGION_BD_BN)} students, ${formatCurrency(serverAmountToMinorUnits(200, REGION_BD_BN), REGION_BD_BN)}`,
    );
    // The preview table shows the row total, not "count x amount".
    const rows = within(screen.getByTestId('fine-preview-rows'));
    expect(await rows.findByText('Late fine')).toBeTruthy();
    expect(
      rows.getByText(formatCurrency(serverAmountToMinorUnits(100, REGION_BD_BN), REGION_BD_BN)),
    ).toBeTruthy();
    expect(rows.queryByText(/2 ×/)).toBeNull();
    // After the preview the primary reads "Generate fines".
    expect(screen.getByRole('button', { name: 'Generate fines' })).toBeTruthy();
  });

  it('does not generate until the second click, and resets when the scope changes', async () => {
    let generated = 0;
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
      http.post('/api/v1/fees/fines/generate/preview', () =>
        HttpResponse.json({
          students: [
            {
              student_id: 's1',
              rule_id: 'r1',
              fee_structure_id: 'f1',
              count: 3,
              amount: 60,
              note: 'x',
            },
          ],
          total_amount: 60,
          would_create: 1,
          duplicates: [],
        }),
      ),
      http.post('/api/v1/fees/fines/generate', () => {
        generated += 1;
        return HttpResponse.json(
          { fee_generation_ids: ['g'], generated_count: 1, skipped_count: 0 },
          { status: 201 },
        );
      }),
    );
    const user = userEvent.setup();
    await renderModal();
    await user.click(await screen.findByRole('button', { name: 'See what will be made' }));
    const create = await screen.findByRole<HTMLButtonElement>('button', { name: 'Generate fines' });
    // Right after the preview arrives the create button is briefly locked.
    expect(create.disabled).toBe(true);
    await user.click(create);
    expect(generated).toBe(0);
    await waitFor(() => expect(create.disabled).toBe(false));
    expect(generated).toBe(0);

    // Changing the scope clears the preview and the label returns.
    await user.click(screen.getByRole('combobox', { name: 'Class' }));
    await user.click(await screen.findByRole('option', { name: 'Class 9' }));
    expect(await screen.findByRole('button', { name: 'See what will be made' })).toBeTruthy();
    expect(screen.queryByRole('heading', { name: 'What will be made' })).toBeNull();

    await user.click(screen.getByRole('button', { name: 'See what will be made' }));
    const again = await screen.findByRole<HTMLButtonElement>('button', { name: 'Generate fines' });
    await waitFor(() => expect(again.disabled).toBe(false));
    await user.click(again);
    await waitFor(() => expect(generated).toBe(1));
  });

  it('shows a translated sentence, never the server text, when preview fails', async () => {
    server.use(
      http.post('/api/v1/fees/fines/generate/preview', () =>
        HttpResponse.json({ statusCode: 422, message: 'Server says no' }, { status: 422 }),
      ),
    );
    const user = userEvent.setup();
    await renderModal();
    await user.click(await screen.findByRole('button', { name: 'See what will be made' }));
    expect(await screen.findByText('Failed to generate fines')).toBeTruthy();
    expect(screen.queryByText('Server says no')).toBeNull();
  });

  it('disables confirm on a zero preview', async () => {
    server.use(
      http.post('/api/v1/fees/fines/generate/preview', () =>
        HttpResponse.json({ students: [], total_amount: 0, would_create: 0, duplicates: [] }),
      ),
    );

    const user = userEvent.setup();
    await renderModal();
    await user.click(await screen.findByRole('button', { name: 'See what will be made' }));

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
    await user.click(await screen.findByRole('button', { name: 'See what will be made' }));
    await screen.findByText('Some fines already exist for this month');

    await user.click(screen.getByRole('radio', { name: /Remove the older fine first/ }));
    const create = await screen.findByRole<HTMLButtonElement>('button', { name: 'Generate fines' });
    await waitFor(() => expect(create.disabled).toBe(false));
    await user.click(create);

    await waitFor(() => expect(requestBody).toBeTruthy());
    expect((requestBody as { duplicate_strategy: string }).duplicate_strategy).toBe('REMOVE_OLDER');
  });

  it('still offers the duplicate choices when every fine already exists (would_create 0)', async () => {
    server.use(
      http.post('/api/v1/fees/fines/generate/preview', () =>
        HttpResponse.json({
          students: [],
          total_amount: 0,
          would_create: 0,
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
    await user.click(await screen.findByRole('button', { name: 'See what will be made' }));

    // The "REMOVE_OLDER" choice is the only way forward here, so it must show.
    expect(await screen.findByRole('radio', { name: /Remove the older fine first/ })).toBeTruthy();
    expect(screen.queryByText('No fines would be generated for this month.')).toBeNull();
  });
});

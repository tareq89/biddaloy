import { REGION_BD_EN } from '@biddaloy/ui/i18n';
import { cleanupTestState, renderWithProviders } from '@biddaloy/ui/test';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { TenderSection } from './tender-section';

async function renderTender(overrides: Partial<React.ComponentProps<typeof TenderSection>> = {}) {
  const onTenderedChange = vi.fn();
  const onChangeHandlingChange = vi.fn();
  const view = renderWithProviders(
    <TenderSection
      config={REGION_BD_EN}
      tenderedMinorUnits={undefined}
      onTenderedChange={onTenderedChange}
      walletUseMinorUnits={0}
      subtotalMinorUnits={495000}
      changeHandling="RETURN"
      onChangeHandlingChange={onChangeHandlingChange}
      {...overrides}
    />,
    { tenantId: 'tenant-1', locale: 'en' },
  );
  await view.localeReady;
  return { onTenderedChange, onChangeHandlingChange };
}

describe('TenderSection', () => {
  afterEach(async () => {
    await cleanupTestState();
  });

  it('[16.4.4] C7: change = wallet_use + tendered − amount due, including wallet credit', async () => {
    // subtotal 4950, wallet 50 used, tendered 5000 -> change 100.
    await renderTender({
      subtotalMinorUnits: 495000,
      walletUseMinorUnits: 5000,
      tenderedMinorUnits: 500000,
    });

    expect(await screen.findByText('৳100.00')).toBeTruthy();
  });

  it('flags a negative computed change as invalid without going negative on screen', async () => {
    await renderTender({ subtotalMinorUnits: 500000, tenderedMinorUnits: 100000 });

    const tenderedInput = await screen.findByLabelText('Tendered');
    expect(tenderedInput.getAttribute('aria-invalid')).toBe('true');
    expect(await screen.findByText('৳0.00')).toBeTruthy();
  });

  it('offers RETURN/TO_WALLET only once there is change to hand back', async () => {
    const user = userEvent.setup();
    const { onChangeHandlingChange } = await renderTender({
      subtotalMinorUnits: 495000,
      tenderedMinorUnits: 500000,
    });

    await user.click(await screen.findByLabelText('Credit change to wallet'));
    expect(onChangeHandlingChange).toHaveBeenCalledWith('TO_WALLET');
  });

  it('hides the RETURN/TO_WALLET choice when there is no change', async () => {
    await renderTender({ subtotalMinorUnits: 500000, tenderedMinorUnits: 500000 });

    await screen.findByLabelText('Tendered');
    expect(screen.queryByLabelText('Return change')).toBeNull();
  });
});

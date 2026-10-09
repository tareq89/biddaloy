import { act, screen } from '@testing-library/react';
import type * as React from 'react';
import { describe, expect, it } from 'vitest';

import { REGION_BD_BN, REGION_BD_EN, RegionConfigProvider } from '../i18n';
import { renderWithProviders } from '../test';

import { TableCount } from './table-count';

async function render(ui: React.ReactElement, region = REGION_BD_EN, locale: 'en' | 'bn' = 'en') {
  const view = renderWithProviders(
    <RegionConfigProvider value={region}>{ui}</RegionConfigProvider>,
    { locale },
  );
  await act(async () => {
    await view.localeReady;
  });
}

describe('TableCount', () => {
  it('shows the range with a total', async () => {
    await render(<TableCount total={312} from={1} to={25} />);
    expect(screen.getByText('Showing 1–25 of 312')).toBeTruthy();
  });

  it('shows a bare total without a range', async () => {
    await render(<TableCount total={12} />);
    expect(screen.getByText('Total 12')).toBeTruthy();
  });

  it('groups a large bare total like the range does', async () => {
    await render(<TableCount total={12345} />);
    expect(screen.getByText('Total 12,345')).toBeTruthy();
  });

  it('uses Bangla digits under REGION_BD_BN', async () => {
    await render(<TableCount total={12} from={1} to={12} />, REGION_BD_BN, 'bn');
    expect(screen.getByText(/১২/)).toBeTruthy();
  });
});

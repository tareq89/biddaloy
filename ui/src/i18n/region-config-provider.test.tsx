import { act, render, screen, waitFor } from '@testing-library/react';
import { describe, it, expect } from 'vitest';

import { createI18nInstance } from './i18n';
import { I18nProvider } from './locale-provider';
import { REGION_BD_BN, REGION_BD_EN, type RegionConfig } from './region-config';
import { RegionConfigProvider, useRegionConfig } from './region-config-provider';

function CurrencySymbol() {
  const { symbol } = useRegionConfig().currency;
  return <p>symbol: {symbol}</p>;
}

function Numerals() {
  return <p>numerals: {useRegionConfig().numerals}</p>;
}

describe('RegionConfigProvider', () => {
  it('defaults to the BD region matching the active locale, and follows it when the locale switches', async () => {
    const instance = createI18nInstance();

    render(
      <I18nProvider i18n={instance}>
        <RegionConfigProvider>
          <Numerals />
        </RegionConfigProvider>
      </I18nProvider>,
    );

    await waitFor(() => expect(screen.getByText('numerals: bengali')).toBeTruthy());

    // Programmatic, not a button + useLocale() in the same tree — a
    // second useTranslation() consumer switching the same instance a
    // Suspense-participating sibling is already subscribed to is prone to
    // timing races React Testing Library's `waitFor` alone doesn't
    // reliably settle; `act` around the actual instance call does.
    await act(async () => {
      await instance.changeLanguage('en');
    });

    await waitFor(() => expect(screen.getByText('numerals: latin')).toBeTruthy());
  });

  it('a caller-supplied value overrides the locale-derived default — the entire "provider swap"', async () => {
    const tenantRegion: RegionConfig = {
      ...REGION_BD_EN,
      currency: { ...REGION_BD_EN.currency, symbol: 'X' },
    };

    render(
      <I18nProvider i18n={createI18nInstance()}>
        <RegionConfigProvider value={tenantRegion}>
          <CurrencySymbol />
        </RegionConfigProvider>
      </I18nProvider>,
    );

    await waitFor(() => expect(screen.getByText('symbol: X')).toBeTruthy());
  });

  it('useRegionConfig falls back to bn-BD outside any provider', () => {
    render(<CurrencySymbol />);

    expect(screen.getByText(`symbol: ${REGION_BD_BN.currency.symbol}`)).toBeTruthy();
  });
});

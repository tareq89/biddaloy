import { renderWithProviders } from '@biddaloy/ui/test';
import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { LegalFooterLinks } from './legal-footer-links';

describe('LegalFooterLinks', () => {
  it('points to the privacy and terms pages', async () => {
    const { localeReady } = renderWithProviders(<LegalFooterLinks />, { locale: 'en' });
    await localeReady;
    expect(screen.getByRole('link', { name: 'Privacy policy' }).getAttribute('href')).toBe(
      '/legal/privacy',
    );
    expect(screen.getByRole('link', { name: 'Terms' }).getAttribute('href')).toBe('/legal/terms');
  });
});

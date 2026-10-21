import { screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { cleanupTestState, renderWithProviders } from '../test/render-with-providers';

import { Monogram, Wordmark } from './brand-mark';

afterEach(async () => {
  await cleanupTestState();
});

describe('BrandMark', () => {
  it('wordmark is an img named by t(brand), coloured per variant', async () => {
    const { container, rerender } = renderWithProviders(<Wordmark variant="light" />, {
      locale: 'en',
    });
    const img = await screen.findByRole('img', { name: 'SchoolManager' });
    expect(img.getAttribute('viewBox')).toBe('0 0 397.8 57');
    // paths: roof, house blocks, "SchoolManag", "ERP"
    const text = () => container.querySelectorAll('path')[2];
    const roof = () => container.querySelectorAll('path')[0];
    expect(text()?.getAttribute('fill')).toBe('#17305e');
    expect(roof()?.getAttribute('fill')).toBe('#e8890c');
    rerender(<Wordmark variant="dark" />);
    expect(text()?.getAttribute('fill')).toBe('#ffffff');
    rerender(<Wordmark variant="mono" />);
    expect(text()?.getAttribute('fill')).toBe('currentColor');
  });

  it('default (auto) follows the theme through CSS variables, not a fixed fill', async () => {
    const { container } = renderWithProviders(<Wordmark />, { locale: 'en' });
    await screen.findByRole('img', { name: 'SchoolManager' });
    const text = container.querySelectorAll('path')[2];
    expect(text?.getAttribute('fill')).toBeNull();
    expect(text?.getAttribute('style')).toContain('var(--brand-mark-ink)');
  });

  it('"ERP" is filled by a gradient whose id is unique per logo', async () => {
    const { container } = renderWithProviders(
      <>
        <Wordmark decorative />
        <Wordmark decorative />
      </>,
      { locale: 'en' },
    );
    const ids = [...container.querySelectorAll('linearGradient')].map((g) => g.id);
    expect(ids).toHaveLength(2);
    expect(new Set(ids).size).toBe(2);
    const erp = container.querySelectorAll('svg')[0]?.querySelectorAll('path')[3];
    expect(erp?.getAttribute('fill')).toBe(`url(#${ids[0]})`);
  });

  it('monogram is named, and hidden from AT when decorative', async () => {
    const { container, rerender } = renderWithProviders(<Monogram />, { locale: 'en' });
    expect(await screen.findByRole('img', { name: 'SchoolManager' })).toBeTruthy();
    rerender(<Monogram decorative />);
    expect(screen.queryByRole('img')).toBeNull();
    expect(container.querySelector('svg')?.getAttribute('aria-hidden')).toBe('true');
  });
});

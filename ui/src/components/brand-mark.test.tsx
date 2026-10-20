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
    expect(img.getAttribute('viewBox')).toBe('-4 0 1677 260');
    expect(container.querySelector('path')?.getAttribute('fill')).toBe('#191919');
    rerender(<Wordmark variant="dark" />);
    expect(container.querySelector('path')?.getAttribute('fill')).toBe('#f5f5f4');
    rerender(<Wordmark variant="mono" />);
    expect(container.querySelector('path')?.getAttribute('fill')).toBe('currentColor');
  });

  it('default (auto) follows the theme through dark: classes, not a fixed fill', async () => {
    const { container } = renderWithProviders(<Wordmark />, { locale: 'en' });
    await screen.findByRole('img', { name: 'SchoolManager' });
    const path = container.querySelector('path');
    expect(path?.getAttribute('fill')).toBeNull();
    expect(path?.getAttribute('class')).toContain('dark:fill-[#f5f5f4]');
  });

  it('monogram is named, and hidden from AT when decorative', async () => {
    const { container, rerender } = renderWithProviders(<Monogram />, { locale: 'en' });
    expect(await screen.findByRole('img', { name: 'SchoolManager' })).toBeTruthy();
    rerender(<Monogram decorative />);
    expect(screen.queryByRole('img')).toBeNull();
    expect(container.querySelector('svg')?.getAttribute('aria-hidden')).toBe('true');
  });
});

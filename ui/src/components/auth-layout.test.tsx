import { screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { cleanupTestState, renderWithProviders } from '../test/render-with-providers';

import { AuthLayout } from './auth-layout';
import { SignInForm } from './sign-in-form';

afterEach(async () => {
  await cleanupTestState();
  delete document.documentElement.dataset.density;
});

describe('AuthLayout', () => {
  it('renders brand, main landmark, children in one section and a labelled language button', async () => {
    const { container } = renderWithProviders(
      <AuthLayout>
        <p>child</p>
      </AuthLayout>,
      { locale: 'en' },
    );

    expect(await screen.findByText('SchoolManager')).toBeTruthy();
    expect(screen.getByRole('main')).toBeTruthy();
    expect(container.querySelectorAll('section')).toHaveLength(1);
    expect(container.querySelector('section')?.textContent).toBe('child');
    expect(screen.getByRole('button', { name: /English/ })).toBeTruthy();
  });

  it('has no theme toggle and sets comfortable density', async () => {
    renderWithProviders(<AuthLayout>x</AuthLayout>, { locale: 'en' });
    await screen.findByRole('main');

    expect(screen.queryByRole('button', { name: 'Theme' })).toBeNull();
    expect(document.documentElement.dataset.density).toBe('comfortable');
  });

  it('uses max-w-md by default and max-w-2xl for size="wide"', async () => {
    const a = renderWithProviders(<AuthLayout>x</AuthLayout>, { locale: 'en' });
    await screen.findByRole('main');
    expect(a.container.querySelector('section')?.parentElement?.className).toContain('max-w-md');
    a.unmount();

    const b = renderWithProviders(<AuthLayout size="wide">x</AuthLayout>, { locale: 'en' });
    await screen.findByRole('main');
    expect(b.container.querySelector('section')?.parentElement?.className).toContain('max-w-2xl');
  });

  it('hides the language row and logo block, and drops the card frame, when printing', async () => {
    const { container } = renderWithProviders(<AuthLayout>x</AuthLayout>, { locale: 'en' });
    await screen.findByRole('main');

    const langRow = screen.getByRole('button', { name: /English/ }).parentElement;
    expect(langRow?.className).toContain('print:hidden');
    expect(screen.getByText('SchoolManager').parentElement?.className).toContain('print:hidden');
    expect(container.querySelector('section')?.className).toContain('print:border-0');
  });

  it('is axe clean with SignInForm inside', async () => {
    const { baseElement } = renderWithProviders(
      <AuthLayout>
        <SignInForm onSubmit={vi.fn()} />
      </AuthLayout>,
      { locale: 'en' },
    );
    await screen.findByRole('heading', { level: 1 });
    await expect(baseElement).toHaveNoViolations();
  });
});

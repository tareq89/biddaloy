import { cleanupTestState, renderWithProviders } from '@biddaloy/ui/test';
import { screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { DemoInboxWarning } from './demo-inbox-warning';
import { useDemoMode } from './use-demo-mode';

vi.mock('./use-demo-mode', () => ({ useDemoMode: vi.fn() }));
const setDemo = (enabled: boolean) =>
  vi.mocked(useDemoMode).mockReturnValue({ enabled, cards: [], password: '' });

afterEach(async () => {
  delete window.__BIDDALOY_CONFIG__;
  await cleanupTestState();
});

describe('DemoInboxWarning', () => {
  it('renders nothing outside the demo', () => {
    setDemo(false);
    const { container } = renderWithProviders(<DemoInboxWarning />, { locale: 'en' });
    expect(container.textContent).toBe('');
  });

  it('shows the danger bar with the inbox link in the demo', async () => {
    setDemo(true);
    window.__BIDDALOY_CONFIG__ = { messageSinkUrl: 'https://inbox-demo.example.com' };
    const { container } = renderWithProviders(<DemoInboxWarning />, { locale: 'en' });
    expect(await screen.findByText(/Do not enter a real phone number/)).toBeTruthy();
    expect(container.querySelector('[data-tone="danger"]')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Open test inbox' }).getAttribute('href')).toBe(
      'https://inbox-demo.example.com',
    );
    expect(container.textContent?.toLowerCase()).not.toMatch(/sink|mailpit/);
  });
});

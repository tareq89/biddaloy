/** [13.5.1] The captcha says so in place when its script cannot load. */
import { cleanupTestState, renderWithProviders } from '@biddaloy/ui/test';
import { screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

afterEach(async () => {
  vi.unstubAllEnvs();
  vi.resetModules();
  document.head.querySelectorAll('script[src*="turnstile"]').forEach((s) => s.remove());
  await cleanupTestState();
});

async function renderTurnstile(siteKey: string) {
  vi.stubEnv('VITE_TURNSTILE_SITE_KEY', siteKey);
  vi.resetModules();
  const { Turnstile } = await import('./turnstile');
  const onToken = vi.fn();
  const view = renderWithProviders(<Turnstile onToken={onToken} />, { locale: 'en' });
  await view.localeReady;
  return { onToken, view };
}

describe('Turnstile', () => {
  it('renders nothing and loads no script without a site key', async () => {
    const { view } = await renderTurnstile('');
    expect(view.container.innerHTML).toBe('');
    expect(document.head.querySelector('script[src*="turnstile"]')).toBeNull();
  });

  it('shows an inline error when the script fails to load', async () => {
    const { onToken } = await renderTurnstile('site-key');
    expect(screen.queryByRole('alert')).toBeNull();

    const script = await waitFor(() => {
      const el = document.head.querySelector<HTMLScriptElement>('script[src*="turnstile"]');
      expect(el).not.toBeNull();
      return el!;
    });
    script.dispatchEvent(new Event('error'));

    expect((await screen.findByRole('alert')).textContent).toMatch(/could not load/);
    expect(onToken).toHaveBeenCalledWith(null);
  });
});

import { cleanupTestState, renderWithProviders } from '@biddaloy/ui/test';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { TestEnvironmentNotice, TestInboxHint } from './test-environment-notice';

// Records every namespace the components ask for, then hands over to the real hook.
const requestedNamespaces = vi.hoisted(() => [] as unknown[]);
vi.mock('@biddaloy/ui/i18n', async (importOriginal) => {
  const real = await importOriginal<typeof import('@biddaloy/ui/i18n')>();
  return {
    ...real,
    useTranslation: ((...args: Parameters<typeof real.useTranslation>) => {
      requestedNamespaces.push(args[0]);
      return real.useTranslation(...args);
    }) as typeof real.useTranslation,
  };
});

const INBOX = 'https://inbox-demo.example.com';
const setConfig = (sentryEnvironment: string, messageSinkUrl = INBOX) => {
  window.__BIDDALOY_CONFIG__ = { sentryEnvironment, messageSinkUrl };
};

afterEach(async () => {
  delete window.__BIDDALOY_CONFIG__;
  sessionStorage.clear();
  vi.restoreAllMocks();
  await cleanupTestState();
});

describe('TestEnvironmentNotice', () => {
  it('renders nothing without a URL', () => {
    setConfig('demo', '');
    const { container } = renderWithProviders(<TestEnvironmentNotice />, { locale: 'en' });
    expect(container.textContent).toBe('');
  });

  it('shows an info bar on demo and a warning bar on staging', async () => {
    setConfig('demo');
    const view = renderWithProviders(<TestEnvironmentNotice />, { locale: 'en' });
    expect(await screen.findByText(/This is the demo site/)).toBeTruthy();
    expect(view.container.querySelector('[data-tone="info"]')).toBeTruthy();
    view.unmount();

    setConfig('staging');
    const staging = renderWithProviders(<TestEnvironmentNotice />, { locale: 'en' });
    expect(await screen.findByText(/This is the staging site/)).toBeTruthy();
    expect(staging.container.querySelector('[data-tone="warning"]')).toBeTruthy();
  });

  it('calls any other environment a test site', async () => {
    setConfig('dev');
    renderWithProviders(<TestEnvironmentNotice />, { locale: 'en' });
    expect(await screen.findByText(/This is the test site/)).toBeTruthy();
  });

  it('opens the inbox in a new tab without an opener', async () => {
    setConfig('demo');
    renderWithProviders(<TestEnvironmentNotice />, { locale: 'en' });
    const link = await screen.findByRole('link', { name: /Open test inbox/ });
    expect(link.getAttribute('href')).toBe(INBOX);
    expect(link.getAttribute('target')).toBe('_blank');
    expect(link.getAttribute('rel')).toBe('noopener noreferrer');
  });

  it('collapses to a pill and remembers it for the session', async () => {
    setConfig('demo');
    renderWithProviders(<TestEnvironmentNotice />, { locale: 'en' });
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Hide' }));
    expect(sessionStorage.getItem('test-inbox-notice')).toBe('1');
    const pill = screen.getByRole('link', { name: 'Open test inbox (new tab)' });
    expect(pill.getAttribute('target')).toBe('_blank');
    expect(screen.queryByText(/This is the demo site/)).toBeNull();
  });

  it('collapses on Escape', async () => {
    setConfig('demo');
    renderWithProviders(<TestEnvironmentNotice />, { locale: 'en' });
    const user = userEvent.setup();
    (await screen.findByRole('link', { name: /Open test inbox/ })).focus();
    await user.keyboard('{Escape}');
    expect(screen.getByRole('link', { name: 'Open test inbox (new tab)' })).toBeTruthy();
  });

  it('still renders and collapses when sessionStorage throws', async () => {
    setConfig('demo');
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    renderWithProviders(<TestEnvironmentNotice />, { locale: 'en' });
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Hide' }));
    expect(screen.getByRole('link', { name: 'Open test inbox (new tab)' })).toBeTruthy();
  });

  it.each(['en', 'bn'] as const)('never says the internal words (%s)', async (locale) => {
    setConfig('staging');
    const { container } = renderWithProviders(
      <>
        <TestEnvironmentNotice />
        <TestInboxHint />
      </>,
      { locale },
    );
    await screen.findAllByRole('link');
    expect(container.textContent).not.toMatch(/mailpit|sink|smtp|provider/i);
  });
});

// [87 F5] i18n loads `demo` lazily with Suspense: asking for it on prod would make every shell and
// the sign-in page fetch and wait on a chunk that renders nothing.
describe('prod (no inbox URL)', () => {
  it('never asks for the demo namespace; with a URL it does (control)', async () => {
    setConfig('prod', '');
    requestedNamespaces.length = 0;
    const prod = renderWithProviders(
      <>
        <TestEnvironmentNotice />
        <TestInboxHint />
      </>,
      { locale: 'en' },
    );
    expect(prod.container.textContent).toBe('');
    expect(requestedNamespaces).not.toContain('demo');
    prod.unmount();

    setConfig('demo');
    renderWithProviders(<TestInboxHint />, { locale: 'en' });
    await screen.findByRole('link');
    expect(requestedNamespaces).toContain('demo');
  });
});

describe('TestInboxHint', () => {
  it('renders nothing without a URL and a link with one', async () => {
    setConfig('demo', '');
    const empty = renderWithProviders(<TestInboxHint />, { locale: 'en' });
    expect(empty.container.textContent).toBe('');
    empty.unmount();
    setConfig('demo');
    renderWithProviders(<TestInboxHint />, { locale: 'en' });
    expect((await screen.findByRole('link')).getAttribute('href')).toBe(INBOX);
  });
});

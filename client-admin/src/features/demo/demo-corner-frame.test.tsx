import { cleanupTestState, renderWithProviders } from '@biddaloy/ui/test';
import { screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { DemoCornerFrame } from './demo-corner-frame';

const demo = vi.hoisted(() => ({ enabled: false }));
vi.mock('./use-demo-mode', () => ({ useDemoMode: () => ({ enabled: demo.enabled }) }));

afterEach(async () => {
  delete window.__BIDDALOY_CONFIG__;
  demo.enabled = false;
  await cleanupTestState();
});

const render = () =>
  renderWithProviders(
    <DemoCornerFrame>
      <p>shell</p>
    </DemoCornerFrame>,
    { locale: 'en' },
  );

describe('DemoCornerFrame env ribbon', () => {
  it('shows DEV', () => {
    window.__BIDDALOY_CONFIG__ = { envBadge: 'DEV' };
    render();
    expect(screen.getByRole('note').textContent).toBe('DEV');
  });

  it('shows STAGING with the date in the UI language', async () => {
    window.__BIDDALOY_CONFIG__ = { envBadge: 'STAGING', envBadgeDate: '2026-10-29' };
    const { localeReady } = render();
    await localeReady;
    expect(await screen.findByText('STAGING · Oct 29, 2026')).toBeTruthy();
  });

  it('shows nothing on prod', () => {
    render();
    expect(screen.queryByRole('note')).toBeNull();
  });

  it('is an in-flow strip, so it cannot cover the header controls', () => {
    window.__BIDDALOY_CONFIG__ = { envBadge: 'DEV' };
    render();
    expect(screen.getByRole('note').className).not.toMatch(/\babsolute\b/);
  });

  it('shows a bare STAGING when no date is loaded', () => {
    window.__BIDDALOY_CONFIG__ = { envBadge: 'STAGING' };
    render();
    expect(screen.getByRole('note').textContent).toBe('STAGING');
  });

  it('shows an unparsable date as given', () => {
    window.__BIDDALOY_CONFIG__ = { envBadge: 'STAGING', envBadgeDate: 'not-a-date' };
    render();
    expect(screen.getByRole('note').textContent).toBe('STAGING · not-a-date');
  });

  it('formats the date in Bangla for a bn user', async () => {
    window.__BIDDALOY_CONFIG__ = { envBadge: 'STAGING', envBadgeDate: '2026-10-29' };
    const { localeReady } = renderWithProviders(
      <DemoCornerFrame>
        <p>shell</p>
      </DemoCornerFrame>,
      { locale: 'bn' },
    );
    await localeReady;
    const text = (await screen.findByRole('note')).textContent ?? '';
    expect(text.startsWith('STAGING · ')).toBe(true);
    expect(text).not.toContain('Oct 29, 2026');
  });

  it('keeps the demo ribbon in the demo, without the env band', async () => {
    demo.enabled = true;
    window.__BIDDALOY_CONFIG__ = { envBadge: 'STAGING', envBadgeDate: '2026-10-29' };
    render();
    expect(await screen.findByText('DEMO')).toBeTruthy();
    expect(screen.queryByText(/STAGING/)).toBeNull();
  });
});

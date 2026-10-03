import '@biddaloy/ui/test';

import { cleanupTestState, renderWithProviders, server } from '@biddaloy/ui/test';
import { screen, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { afterEach, describe, expect, it } from 'vitest';

import { PresetWarningBanner } from './PresetWarningBanner';

const status = (body: unknown, code = 200) =>
  server.use(
    http.get('/api/v1/presets/status', () => HttpResponse.json(body as object, { status: code })),
  );
const render = () =>
  renderWithProviders(<PresetWarningBanner />, { locale: 'en', tenantId: 'tenant-1' });

describe('PresetWarningBanner', () => {
  afterEach(async () => {
    await cleanupTestState();
  });

  it('renders for APPLIED and is axe clean', async () => {
    status({
      state: 'APPLIED',
      preset: { id: 'bd/nctb', version: '2026.1', appliedAt: '2026-01-01T00:00:00Z' },
    });
    const { container } = render();
    expect(await screen.findByRole('note')).toBeTruthy();
    expect(screen.getByText(/Results already published will not change/)).toBeTruthy();
    await expect(container).toHaveNoViolations();
  });

  it.each(['AVAILABLE', 'CUSTOM'])('renders nothing for %s', async (state) => {
    let hit = false;
    server.use(
      http.get('/api/v1/presets/status', () => ((hit = true), HttpResponse.json({ state }))),
    );
    const { container } = render();
    await waitFor(() => expect(hit).toBe(true));
    await new Promise((r) => setTimeout(r, 20));
    expect(container.innerHTML).toBe('');
  });

  it('renders nothing while loading', () => {
    server.use(http.get('/api/v1/presets/status', () => new Promise(() => {})));
    const { container } = render();
    expect(container.innerHTML).toBe('');
  });

  it('renders nothing on error', async () => {
    status({ message: 'boom' }, 400);
    const { container } = render();
    await new Promise((r) => setTimeout(r, 50));
    expect(container.innerHTML).toBe('');
  });
});

import { cleanupTestState, renderWithProviders, server } from '@biddaloy/ui/test';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { DemoRoleCards } from './demo-role-cards';
import { useDemoMode, type DemoRoleCard } from './use-demo-mode';

afterEach(async () => {
  await cleanupTestState();
});

const card = (key: string, role: string, email: string): DemoRoleCard => ({
  key,
  role,
  email,
  branchSlug: 'bmsc-high',
  nameEn: key,
  nameBn: key,
  tryKey: 'dashboard',
});
const CARDS = [
  card('admin', 'ADMIN', 'admin@bmsc.example'),
  card('principal', 'EXECUTIVE', 'principal@bmsc.example'),
];

describe('DemoRoleCards', () => {
  it('renders the cards in order, focuses the first, and Enter picks it', async () => {
    const onPick = vi.fn();
    const user = userEvent.setup();
    renderWithProviders(<DemoRoleCards cards={CARDS} onPick={onPick} />, { locale: 'en' });

    const buttons = await screen.findAllByRole('button');
    expect(buttons.map((b) => b.textContent)).toEqual([
      expect.stringContaining('Admin (all three branches)'),
      expect.stringContaining('Principal'),
    ]);
    await waitFor(() => expect(document.activeElement).toBe(buttons[0]));

    await user.keyboard('{Enter}');
    expect(onPick).toHaveBeenCalledWith(expect.objectContaining({ email: 'admin@bmsc.example' }));
  });
});

function Probe() {
  const demo = useDemoMode();
  return <p>{demo.enabled ? `on:${demo.cards.length}` : 'off'}</p>;
}

describe('useDemoMode', () => {
  it('is on when /demo/roles answers', async () => {
    server.use(
      http.get('/api/v1/demo/roles', () => HttpResponse.json({ password: 'x', cards: CARDS })),
    );
    renderWithProviders(<Probe />, { locale: 'en' });
    expect(await screen.findByText('on:2')).toBeTruthy();
  });

  it('a 404 means not a demo: no cards', async () => {
    server.use(http.get('/api/v1/demo/roles', () => new HttpResponse(null, { status: 404 })));
    renderWithProviders(<Probe />, { locale: 'en' });
    await waitFor(() => expect(screen.getByText('off')).toBeTruthy());
  });
});

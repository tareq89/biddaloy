import '@biddaloy/ui/test';

import { cleanupTestState, renderWithProviders } from '@biddaloy/ui/test';
import { screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { WithTestRouter } from '../with-test-router';

import { KIND_FIXTURES } from './kind-fixtures';
import { KindCards } from './KindCards';

const opts = { locale: 'en' as const, role: 'ADMIN' as const, tenantId: 'school-1' };

function renderCards(props: Partial<React.ComponentProps<typeof KindCards>> = {}) {
  const onSelect = vi.fn();
  const onRetry = vi.fn();
  const view = renderWithProviders(
    <WithTestRouter>
      <KindCards kinds={KIND_FIXTURES} onSelect={onSelect} onRetry={onRetry} {...props} />
    </WithTestRouter>,
    opts,
  );
  return { ...view, onSelect, onRetry };
}

describe('KindCards', () => {
  afterEach(async () => {
    await cleanupTestState();
  });

  it('renders the eight kinds and flags only the unverified ones', async () => {
    renderCards();

    const list = await screen.findByRole('list');
    expect(within(list).getAllByRole('button')).toHaveLength(8);
    expect(screen.getByRole('button', { name: /Coaching centre/ })).toBeTruthy();
    // College, Qawmi madrasa and Technical institute (D25).
    expect(screen.getAllByText('Not verified yet')).toHaveLength(3);
    expect(
      within(screen.getByRole('button', { name: /Qawmi madrasa/ })).getByText('Not verified yet'),
    ).toBeTruthy();
    expect(
      within(screen.getByRole('button', { name: /Primary school/ })).queryByText(
        'Not verified yet',
      ),
    ).toBeNull();
  });

  it('clicking a card selects that kind', async () => {
    const { user, onSelect } = renderCards();

    await user.click(await screen.findByRole('button', { name: /Coaching centre/ }));

    expect(onSelect).toHaveBeenCalledExactlyOnceWith('coaching');
  });

  it('marks the open kind as pressed', async () => {
    renderCards({ selectedId: 'coaching' });

    const card = await screen.findByRole('button', { name: /Coaching centre/ });
    expect(card.getAttribute('aria-pressed')).toBe('true');
    expect(
      screen.getByRole('button', { name: /Primary school/ }).getAttribute('aria-pressed'),
    ).toBe('false');
  });

  it('shows Bangla names when the language is Bangla', async () => {
    renderWithProviders(
      <WithTestRouter>
        <KindCards kinds={KIND_FIXTURES} onSelect={vi.fn()} onRetry={vi.fn()} />
      </WithTestRouter>,
      { ...opts, locale: 'bn' },
    );

    expect(await screen.findByRole('button', { name: /কওমি মাদ্রাসা/ })).toBeTruthy();
    expect(screen.getAllByText('যাচাই বাকি')).toHaveLength(3);
  });

  it('shows a busy placeholder while loading, with no buttons', async () => {
    renderCards({ kinds: undefined, loading: true });

    expect(await screen.findByLabelText('Loading institution kinds')).toBeTruthy();
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('shows a fixed error with a retry that calls onRetry', async () => {
    const { user, onRetry } = renderCards({ kinds: undefined, error: true });

    expect(
      await screen.findByText('Could not load the institution kinds. Try again.'),
    ).toBeTruthy();
    await user.click(screen.getByRole('button', { name: /try again|retry/i }));
    await waitFor(() => expect(onRetry).toHaveBeenCalledTimes(1));
  });
});

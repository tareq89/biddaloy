import '@biddaloy/ui/test';

import type { ImpersonationSessionDto } from '@biddaloy/shared';
import { i18n } from '@biddaloy/ui/i18n';
import { cleanupTestState, renderWithProviders } from '@biddaloy/ui/test';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { LiveSessionsStripView } from './-live-sessions-strip';

const NOW = Date.parse('2030-01-01T00:00:00.000Z');
const session = {
  id: 's1',
  schoolName: 'Rose Valley School',
  userName: 'Anika Rahman',
  role: 'TEACHER',
  expiresAt: '2030-01-01T00:42:00.000Z',
} as ImpersonationSessionDto;

describe('LiveSessionsStripView', () => {
  afterEach(async () => {
    await cleanupTestState();
  });

  const useEnglish = async () => {
    await i18n.loadNamespaces(['schoolsList', 'loginAs']);
    await i18n.changeLanguage('en');
  };

  it('renders nothing when no one is signed in', async () => {
    await useEnglish();
    const { container } = renderWithProviders(
      <LiveSessionsStripView sessions={[]} now={NOW} onEnd={() => {}} />,
    );
    expect(container.querySelector('section')).toBeNull();
  });

  it('shows school, person, role and minutes left; End asks first, then calls once', async () => {
    const user = userEvent.setup();
    const onEnd = vi.fn();
    await useEnglish();
    renderWithProviders(<LiveSessionsStripView sessions={[session]} now={NOW} onEnd={onEnd} />);

    expect(
      await screen.findByText(/Rose Valley School - Anika Rahman, Teacher - (42|৪২) min left/),
    ).toBeTruthy();
    await user.click(
      screen.getByRole('button', { name: "End Anika Rahman's visit to Rose Valley School" }),
    );
    expect(onEnd).not.toHaveBeenCalled();
    await user.click(await screen.findByRole('button', { name: 'End' }));
    expect(onEnd).toHaveBeenCalledTimes(1);
    expect(onEnd).toHaveBeenCalledWith('s1');
  });

  it('says the list could not be read, with Try again, instead of hiding the strip', async () => {
    const user = userEvent.setup();
    const onRetry = vi.fn();
    await useEnglish();
    renderWithProviders(
      <LiveSessionsStripView
        sessions={[]}
        now={NOW}
        onEnd={() => {}}
        readError
        onRetry={onRetry}
      />,
    );
    expect((await screen.findByRole('alert')).textContent).toContain(
      'Could not load who is signed in.',
    );
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });
});

import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import type { NotificationRecord } from '../api/notification-state';
import { renderWithProviders } from '../test/render-with-providers';

import { NotificationList } from './notification-list';

/** Forces English and waits for the bundle, since the app's default
 * locale is Bengali — same pattern `access-denied-state.test.tsx` uses. */
async function renderInEnglish(
  ui: Parameters<typeof renderWithProviders>[0],
): Promise<ReturnType<typeof renderWithProviders>> {
  const result = renderWithProviders(ui, { locale: 'en' });
  await result.localeReady;
  return result;
}

function makeNotification(overrides: Partial<NotificationRecord> = {}): NotificationRecord {
  return {
    id: 'n-1',
    tenantId: 'school-a',
    message: 'Payment recorded for Aisha',
    createdAt: new Date(Date.now() - 60_000).toISOString(),
    read: false,
    variant: 'success',
    ...overrides,
  };
}

describe('NotificationList', () => {
  it('renders each variant with its own icon and accessible text label, not colour alone', async () => {
    await renderInEnglish(
      <NotificationList
        notifications={[
          makeNotification({ id: 'success', variant: 'success', message: 'Payment recorded' }),
          makeNotification({ id: 'error', variant: 'error', message: 'SMS delivery failed' }),
          makeNotification({ id: 'info', variant: 'info', message: 'Batch queued' }),
        ]}
        onMarkRead={() => {}}
        emptyLabel="Nothing yet"
      />,
    );

    expect(await screen.findByText('Success')).toBeTruthy();
    expect(screen.getByText('Failed')).toBeTruthy();
    expect(screen.getByText('Info')).toBeTruthy();
  });

  it('renders timestamps relatively, not as a raw locale date-time string', async () => {
    await renderInEnglish(
      <NotificationList
        notifications={[makeNotification()]}
        onMarkRead={() => {}}
        emptyLabel="Nothing yet"
      />,
    );

    expect(await screen.findByText(/minute ago/)).toBeTruthy();
  });

  it('renders timestamps in Bengali digits under the bn locale', async () => {
    const result = renderWithProviders(
      <NotificationList
        notifications={[makeNotification()]}
        onMarkRead={() => {}}
        emptyLabel="কিছু নেই"
      />,
      { locale: 'bn' },
    );
    await result.localeReady;

    expect(screen.getByText(/[০-৯]/)).toBeTruthy();
  });

  it('calls onMarkRead with the record id when its row is activated', async () => {
    const user = userEvent.setup();
    const onMarkRead = vi.fn();
    await renderInEnglish(
      <NotificationList
        notifications={[makeNotification({ id: 'n-42' })]}
        onMarkRead={onMarkRead}
        emptyLabel="Nothing yet"
      />,
    );

    await user.click(screen.getByRole('button', { name: /Payment recorded for Aisha/ }));

    expect(onMarkRead).toHaveBeenCalledWith('n-42');
  });

  it('disables a row that is already read', async () => {
    await renderInEnglish(
      <NotificationList
        notifications={[makeNotification({ read: true })]}
        onMarkRead={() => {}}
        emptyLabel="Nothing yet"
      />,
    );

    expect(
      screen.getByRole<HTMLButtonElement>('button', { name: /Payment recorded for Aisha/ })
        .disabled,
    ).toBe(true);
  });

  it('shows the empty label when there are no notifications', async () => {
    await renderInEnglish(
      <NotificationList notifications={[]} onMarkRead={() => {}} emptyLabel="Nothing yet" />,
    );

    expect(screen.getByText('Nothing yet')).toBeTruthy();
  });

  it('has no axe violations', async () => {
    const { container } = await renderInEnglish(
      <NotificationList
        notifications={[makeNotification()]}
        onMarkRead={() => {}}
        emptyLabel="Nothing yet"
      />,
    );

    await expect(container).toHaveNoViolations();
  });
});

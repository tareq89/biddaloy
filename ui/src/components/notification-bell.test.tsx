import { QueryClientProvider } from '@tanstack/react-query';
import {
  createMemoryHistory,
  createRootRoute,
  createRouter,
  RouterProvider,
} from '@tanstack/react-router';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';

import { clearNotifications, pushNotification } from '../api/notification-state';
import { i18n } from '../i18n/i18n';
import { I18nProvider } from '../i18n/locale-provider';
import { createTestQueryClient, renderWithProviders } from '../test/render-with-providers';

import { NotificationBell } from './notification-bell';
import type { NotificationBellProps } from './notification-bell';

/** Forces English and waits for the bundle, since the app's default
 * locale is Bengali — same pattern `access-denied-state.test.tsx` uses. */
async function renderInEnglish(
  ui: Parameters<typeof renderWithProviders>[0],
): Promise<ReturnType<typeof renderWithProviders>> {
  const result = renderWithProviders(ui, { locale: 'en' });
  await result.localeReady;
  return result;
}

/** `<Link>` needs a router in context — `renderWithProviders` deliberately
 * doesn't supply one (see its own header comment), so the `viewAllTo`
 * cases build a minimal one-route tree, the same shape the storybook
 * `withMemoryRouter` decorator uses. */
async function renderWithRouterInEnglish(props: NotificationBellProps = {}) {
  await i18n.changeLanguage('en');
  const queryClient = createTestQueryClient();
  function Root() {
    return <NotificationBell {...props} />;
  }
  const rootRoute = createRootRoute({ component: Root });
  const router = createRouter({
    routeTree: rootRoute,
    history: createMemoryHistory({ initialEntries: ['/staff'] }),
    context: { queryClient },
  });
  const view = render(
    <QueryClientProvider client={queryClient}>
      <I18nProvider>
        <RouterProvider router={router} />
      </I18nProvider>
    </QueryClientProvider>,
  );
  return view;
}

describe('NotificationBell', () => {
  afterEach(() => {
    clearNotifications();
  });

  it('has no unread badge and shows the empty state when there is no history', async () => {
    const user = userEvent.setup();
    await renderInEnglish(<NotificationBell />);

    expect(await screen.findByRole('button', { name: 'Notifications' })).toBeTruthy();

    await user.click(screen.getByRole('button', { name: 'Notifications' }));
    expect(await screen.findByText("You're all caught up.")).toBeTruthy();
  });

  it('shows an unread count in the trigger’s accessible name, and lists history in the panel', async () => {
    const user = userEvent.setup();
    pushNotification({ tenantId: null, message: 'Bulk import finished', variant: 'success' });
    pushNotification({ tenantId: null, message: 'SMS delivery failed', variant: 'error' });
    await renderInEnglish(<NotificationBell />);

    const trigger = await screen.findByRole('button', { name: 'Notifications, 2 unread' });
    await user.click(trigger);

    expect(await screen.findByText('Bulk import finished')).toBeTruthy();
    expect(screen.getByText('SMS delivery failed')).toBeTruthy();
  });

  it('marking a single notification read updates the unread count', async () => {
    const user = userEvent.setup();
    pushNotification({ tenantId: null, message: 'Bulk import finished', variant: 'success' });
    await renderInEnglish(<NotificationBell />);

    await user.click(await screen.findByRole('button', { name: 'Notifications, 1 unread' }));
    await user.click(await screen.findByRole('button', { name: /Bulk import finished/ }));

    expect(await screen.findByRole('button', { name: 'Notifications' })).toBeTruthy();
  });

  it('"mark all read" clears the unread count and is disabled once nothing is unread', async () => {
    const user = userEvent.setup();
    pushNotification({ tenantId: null, message: 'First', variant: 'info' });
    pushNotification({ tenantId: null, message: 'Second', variant: 'info' });
    await renderInEnglish(<NotificationBell />);

    await user.click(await screen.findByRole('button', { name: 'Notifications, 2 unread' }));
    const markAllRead = await screen.findByRole<HTMLButtonElement>('button', {
      name: 'Mark all read',
    });
    expect(markAllRead.disabled).toBe(false);

    await user.click(markAllRead);

    expect(await screen.findByRole('button', { name: 'Notifications' })).toBeTruthy();
    expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Mark all read' }).disabled).toBe(
      true,
    );
  });

  it('trigger is reachable by Tab and opens the panel on Enter', async () => {
    const user = userEvent.setup();
    await renderInEnglish(<NotificationBell />);
    await screen.findByRole('button', { name: 'Notifications' });

    await user.tab();
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Notifications' }));

    await user.keyboard('{Enter}');
    expect(await screen.findByText("You're all caught up.")).toBeTruthy();
  });

  it('renders the unread badge count in Bengali digits under the bn locale', async () => {
    pushNotification({ tenantId: null, message: 'Bulk import finished', variant: 'success' });
    const result = renderWithProviders(<NotificationBell />, { locale: 'bn' });
    await result.localeReady;

    expect(await screen.findByText('১')).toBeTruthy();
  });

  it('renders a "9+" style overflow badge when there are more than nine unread', async () => {
    for (let i = 0; i < 10; i += 1) {
      pushNotification({ tenantId: null, message: `Notification ${i}`, variant: 'info' });
    }
    await renderInEnglish(<NotificationBell />);

    expect(await screen.findByText('9+')).toBeTruthy();
  });

  it('gives the trigger a translated accessible name that includes the unread count', async () => {
    pushNotification({ tenantId: null, message: 'Bulk import finished', variant: 'success' });
    await renderInEnglish(<NotificationBell />);

    expect(await screen.findByRole('button', { name: 'Notifications, 1 unread' })).toBeTruthy();
  });

  it('renders the view-all link only when viewAllTo is given', async () => {
    const user = userEvent.setup();
    await renderWithRouterInEnglish({ viewAllTo: '/notifications' });

    await user.click(await screen.findByRole('button', { name: 'Notifications' }));

    expect(await screen.findByRole('link', { name: 'View all notifications' })).toBeTruthy();
  });

  it('does not render the view-all link when viewAllTo is omitted', async () => {
    const user = userEvent.setup();
    await renderInEnglish(<NotificationBell />);

    await user.click(await screen.findByRole('button', { name: 'Notifications' }));
    await screen.findByText("You're all caught up.");

    expect(screen.queryByRole('link', { name: 'View all notifications' })).toBeNull();
  });

  it('closes the popover when the view-all link is activated', async () => {
    const user = userEvent.setup();
    await renderWithRouterInEnglish({ viewAllTo: '/notifications' });

    await user.click(await screen.findByRole('button', { name: 'Notifications' }));
    const link = await screen.findByRole('link', { name: 'View all notifications' });
    await user.click(link);

    expect(screen.queryByRole('link', { name: 'View all notifications' })).toBeNull();
  });

  it('is axe clean, both closed and with the panel open showing history', async () => {
    const user = userEvent.setup();
    pushNotification({ tenantId: null, message: 'Bulk import finished', variant: 'success' });
    const { baseElement } = await renderInEnglish(<NotificationBell />);
    await screen.findByRole('button', { name: 'Notifications, 1 unread' });
    await expect(baseElement).toHaveNoViolations();

    await user.click(screen.getByRole('button', { name: 'Notifications, 1 unread' }));
    await screen.findByText('Bulk import finished');
    // Panel content is portaled to `document.body`, outside `container` —
    // `baseElement` (the portal's actual root) is what needs to be axe clean.
    await expect(baseElement).toHaveNoViolations();
  });
});

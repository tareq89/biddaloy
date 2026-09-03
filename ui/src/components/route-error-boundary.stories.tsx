/**
 * `RouteErrorFallback` reads `ErrorComponentProps` (`error`/`reset`) from
 * the router, not from plain props — so every story wires it through
 * `withMemoryRouter`'s root route rather than passing `error`/`reset`
 * directly as `args`.
 */
import type { Meta, StoryObj } from '@storybook/react-vite';

import { withMemoryRouter } from '../../.storybook/router-decorator';

import { RouteErrorFallback } from './route-error-boundary';

const meta: Meta<typeof RouteErrorFallback> = {
  title: 'Components/RouteErrorFallback',
  component: RouteErrorFallback,
  tags: ['autodocs'],
  args: {
    error: new Error('Dues page exploded'),
    reset: () => {},
  },
  decorators: [withMemoryRouter(['/'])],
};

export default meta;
type Story = StoryObj<typeof RouteErrorFallback>;

/** A genuine crash — a route's `component`/`loader` threw. Renders
 * `ErrorState`: `role="alert"`, reported to Sentry. */
export const Default: Story = {};

/** A 404-shaped route error: no matching route, so `errorComponent`
 * receives whatever the app threw for the miss. `RouteErrorFallback` does
 * not special-case "not found" — it is still a genuine application fault
 * (a bad link, a stale bookmark to a route that moved), so it renders the
 * same `ErrorState` as any other crash rather than the offline/update
 * forks. */
export const NotFound: Story = {
  args: {
    error: new Error('Not Found'),
    message: 'This page could not be found.',
  },
};

import type { Decorator } from '@storybook/react-vite';
import {
  createMemoryHistory,
  createRootRoute,
  createRouter,
  RouterProvider,
} from '@tanstack/react-router';

/**
 * Storybook has no app-wide router — every story whose component reads
 * router context (`useSearch`, `useNavigate`, `Link`, `useDetailShellTab`,
 * ...) needs one of its own. A factory, not a single shared decorator,
 * since different stories need different `initialEntries` (a
 * `?tab=payments` deep link, a `?page=2` list state, ...) — the same
 * reason each shell's own stories previously built their own
 * `<MemoryRouter initialEntries={...}>` per story rather than sharing one
 * at the `meta` level (react-router didn't allow nesting `<Router>`s
 * either, so this constraint isn't new with the [8.9.1] router switch).
 */
export function withMemoryRouter(initialEntries: string[]): Decorator {
  // `react/display-name` flags this factory's returned function as an
  // unnamed component — `rtlDecorator` avoids the same warning by being a
  // `const` assigned once at module scope, but `withMemoryRouter` has to
  // return a *new* decorator per call (different `initialEntries` each
  // time), so there's no single named binding the rule can credit.
  // eslint-disable-next-line react/display-name
  return (StoryFn) => {
    function StoryRoute() {
      return <StoryFn />;
    }
    const rootRoute = createRootRoute({ component: StoryRoute });
    const router = createRouter({
      routeTree: rootRoute,
      history: createMemoryHistory({ initialEntries }),
    });
    return <RouterProvider router={router} />;
  };
}

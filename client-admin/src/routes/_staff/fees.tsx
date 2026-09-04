import { createFileRoute, Outlet } from '@tanstack/react-router';

/**
 * `/fees` layout — no UI of its own, just an `<Outlet />` for its leaves
 * (`/fees` itself → `fees/index.tsx`'s placeholder, `/fees/dues` →
 * [8.10.4]'s dues queue). Splitting the placeholder out of this file and
 * into `fees/index.tsx` is what lets `/fees/dues` render its own
 * component instead of being swallowed by a parent that had no `<Outlet
 * />` — TanStack Router only renders a child route's component through
 * one, the same reason `_staff.tsx` (this route's own parent) has one.
 */
export const Route = createFileRoute('/_staff/fees')({
  // [8.14.5]: no loader here, deliberately — this is a pure layout shell
  // (see the comment above) that renders no strings of its own, just an
  // `<Outlet />`. Its leaves (`fees/index.tsx`, `fees/dues.tsx`,
  // `fees/generate.tsx`) each own their own loader/namespace preload.
  component: () => <Outlet />,
});

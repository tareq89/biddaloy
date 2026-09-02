import type { Meta, StoryObj } from '@storybook/react-vite';

import { RouteProgress } from './route-progress';

/** A stand-in `z-30` header, the same layer #366's real sticky `AppShell`
 * header renders at — proves the bar (`z-40`) sits visibly above it
 * rather than being tucked underneath. */
function MockStickyHeader() {
  return (
    <div className="relative h-40 overflow-hidden border border-border-subtle">
      <div className="sticky top-0 z-30 flex h-14 items-center border-b border-border-subtle bg-surface px-4 text-sm text-muted-foreground">
        Sticky header (z-30)
      </div>
      <div className="p-4 text-sm text-muted-foreground">Page content below the header.</div>
    </div>
  );
}

const meta: Meta<typeof RouteProgress> = {
  title: 'Components/RouteProgress',
  component: RouteProgress,
  tags: ['autodocs'],
};

export default meta;
type Story = StoryObj<typeof RouteProgress>;

/** Between navigations — mounted, but invisible (`opacity-0`,
 * `aria-hidden`), not unmounted. */
export const Idle: Story = {
  args: { active: false, label: 'Loading' },
};

/** While `router.state.isLoading` is true — `__root.tsx` wires this
 * straight off router state. */
export const Active: Story = {
  args: { active: true, label: 'Loading' },
};

/** Renders inside a mock `z-30` sticky header to prove the bar's `z-40`
 * keeps it visible above the chrome, not hidden underneath it.
 *
 * `RouteProgress` is `position: fixed`, which positions against the
 * viewport, not against an ordinary `relative` ancestor — so this
 * wrapper carries `translate-x-0` (any non-`none` `transform`) purely to
 * make itself a CSS containing block for that fixed descendant. Without
 * it the bar would render at the real viewport's top edge, outside this
 * story's own box, and the "sits above the header" claim below would be
 * unverifiable in the Storybook canvas. */
export const ActiveWithStickyHeader: Story = {
  args: { active: true, label: 'Loading' },
  render: (args) => (
    <div className="relative translate-x-0">
      <RouteProgress {...args} />
      <MockStickyHeader />
    </div>
  ),
};

/** Under `prefers-reduced-motion: reduce`, the OS setting (not a
 * Storybook toolbar control — this package has none for it) makes the
 * browser itself collapse the `transition`/`animation` durations here to
 * near-zero via `globals.css`'s blanket `@media (prefers-reduced-motion:
 * reduce)` rule. The bar still communicates "busy" via `aria-busy`, just
 * without the moving stripe.
 *
 * Storybook has no built-in "force this media feature" control, so this
 * story cannot force the reduced state on its own — `parameters.chromatic
 * .forcedColors`/media-feature emulation isn't wired up in this package.
 * Verify by toggling "Reduce motion" in your OS accessibility settings
 * (or DevTools' Rendering panel → "Emulate CSS media feature
 * prefers-reduced-motion") against this same story. */
export const ReducedMotion: Story = {
  args: { active: true, label: 'Loading' },
};

/**
 * Foundations story for the motion vocabulary (design contract §7): three
 * durations, two easing curves, nothing else — "how fast should this be?"
 * is meant to be a lookup, not a judgement call.
 *
 * The values shown are read live off `document.documentElement` via
 * `useComputedVar` (same helper `colors.stories.tsx` uses), not re-typed
 * from `tailwind.preset.ts`'s `motion` export — `globals.css` mirrors that
 * export into a plain `:root` block (deliberately not `@theme`, see that
 * file's own comment on why an `@theme` declaration here would tree-shake to
 * zero bytes), and this page proves the mirror rather than trusting it.
 *
 * The demo tiles use Tailwind v4's arbitrary custom-property syntax
 * (`duration-(--motion-duration-fast)`), exactly as `tailwind.preset.ts`'s
 * own header comment documents it — `--motion-*` is not one of v4's utility
 * namespaces, so no `duration-fast` class exists to reach for instead.
 *
 * This file does not re-implement `e2e/reduced-motion.spec.ts` — that suite
 * already proves, in a real browser under `prefers-reduced-motion: reduce`,
 * that a genuinely-animating element collapses to a near-zero transition
 * rather than skipping the transition (and its `transitionend` event)
 * altogether. jsdom has no paint engine and Storybook has no way to force
 * the OS media query, so nothing here could reprove that; this page is a
 * lookup table and a live demo, not a test.
 *
 * [8.14.12] added the "Where the tokens are used" table and the nav-item /
 * card-hover demos below, using the exact class strings their real
 * components ship (`app-shell.tsx`'s `NavLink`, `card.tsx`), not
 * hand-typed lookalikes — so this page can drift out of sync with the
 * table above (the tokens list) but not with what actually ships.
 */
import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState } from 'react';

import { useComputedVar } from './use-computed-var';

const meta: Meta = {
  title: 'Foundations/Motion',
};

export default meta;
type Story = StoryObj;

const DURATIONS = [
  {
    label: 'durationFast',
    varName: '--motion-duration-fast',
    use: 'Hover, focus ring, active',
    tileClassName:
      'transition-transform duration-(--motion-duration-fast) ease-(--motion-ease-standard) hover:translate-x-6',
  },
  {
    label: 'durationBase',
    varName: '--motion-duration-base',
    use: 'Dropdown, popover, select, tooltip',
    tileClassName:
      'transition-transform duration-(--motion-duration-base) ease-(--motion-ease-standard) hover:translate-x-6',
  },
  {
    label: 'durationSlow',
    varName: '--motion-duration-slow',
    use: 'Dialog, drawer, toast',
    tileClassName:
      'transition-transform duration-(--motion-duration-slow) ease-(--motion-ease-standard) hover:translate-x-6',
  },
] as const;

function DurationTile({
  label,
  varName,
  use,
  tileClassName,
}: {
  label: string;
  varName: string;
  use: string;
  tileClassName: string;
}) {
  const value = useComputedVar(varName);
  return (
    <div className="flex flex-col gap-2">
      <p className="text-caption text-muted-foreground">
        <code>{varName}</code> — {value || '…'}. {use}.
      </p>
      <div className="w-fit rounded-md bg-muted p-2">
        <div className={`size-8 rounded-md bg-primary ${tileClassName}`} />
      </div>
      <p className="text-caption text-muted-foreground">
        Hover the tile — <code>{label}</code>.
      </p>
    </div>
  );
}

/**
 * The two easing curves, shown on a click rather than a hover: `easeExit`
 * only ever applies to something leaving, so a toggle that actually mounts
 * and unmounts the panel is the honest demonstration — a hover would only
 * ever show the enter half.
 */
function EasingDemo() {
  const [open, setOpen] = useState(true);
  const standard = useComputedVar('--motion-ease-standard');
  const exit = useComputedVar('--motion-ease-exit');

  return (
    <div className="flex flex-col gap-2">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-fit rounded-md border border-border-functional bg-card px-3 py-1.5 text-label"
      >
        {open ? 'Close panel' : 'Open panel'}
      </button>
      <p className="text-caption text-muted-foreground">
        <code>--motion-ease-standard</code> ({standard || '…'}) on enter,{' '}
        <code>--motion-ease-exit</code> ({exit || '…'}) on exit — the panel below uses whichever
        curve applies to the transition actually in flight.
      </p>
      <div
        className={[
          'w-64 overflow-hidden rounded-md border border-border-subtle bg-card p-4 transition-[opacity,transform]',
          'duration-(--motion-duration-base)',
          open
            ? 'opacity-100 ease-(--motion-ease-standard)'
            : 'pointer-events-none -translate-y-1 opacity-0 ease-(--motion-ease-exit)',
        ].join(' ')}
      >
        Guardian phone number confirmed.
      </div>
    </div>
  );
}

/**
 * [8.14.12]: which real component actually binds each token, so the
 * durations table above isn't just an aspiration. Kept as data rather than
 * prose so it stays scannable as the consumer list grows.
 */
const TOKEN_CONSUMERS: ReadonlyArray<{ token: string; consumers: string }> = [
  {
    token: '--motion-duration-fast',
    consumers:
      'button, nav links (app-shell), bottom-nav items, card hover (card + portal ChildCard), table rows, tabs, select trigger',
  },
  {
    token: '--motion-duration-base',
    consumers: 'popover / tooltip / dropdown / select content, skeleton arrival, toast exit',
  },
  {
    token: '--motion-duration-slow',
    consumers: 'dialog, mobile drawer, toast enter',
  },
];

function TokenConsumersTable() {
  return (
    <table className="w-full text-left text-caption">
      <caption className="mb-2 text-left text-body text-muted-foreground">
        Where the tokens are used
      </caption>
      <thead>
        <tr className="border-b border-border-subtle">
          <th className="py-1 pr-4 font-medium text-foreground">Token</th>
          <th className="py-1 font-medium text-foreground">Real consumers</th>
        </tr>
      </thead>
      <tbody>
        {TOKEN_CONSUMERS.map((row) => (
          <tr key={row.token} className="border-b border-border-subtle last:border-0">
            <td className="py-1.5 pr-4 align-top">
              <code>{row.token}</code>
            </td>
            <td className="py-1.5 align-top text-muted-foreground">{row.consumers}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/**
 * [8.14.12]: the exact class string `app-shell.tsx`'s `NavLink` renders for
 * its inactive state — copied here rather than re-derived so this demo
 * cannot silently drift from what the sidebar actually ships.
 */
function NavItemDemo() {
  return (
    <div className="flex flex-col gap-2">
      <a
        href="#nav-item-demo"
        onClick={(event) => event.preventDefault()}
        className="relative flex w-fit items-center gap-2 rounded-md py-2 ps-6 pe-3 text-sm text-muted-foreground transition-colors duration-(--motion-duration-fast) ease-(--motion-ease-standard) hover:bg-accent hover:text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring"
      >
        Student Dues
      </a>
      <p className="text-caption text-muted-foreground">
        Hover — the sidebar nav link&rsquo;s real class string (<code>app-shell.tsx</code>).
      </p>
    </div>
  );
}

/**
 * [8.14.12]: `Card`'s own base classes plus the one-token `hover:shadow-e2`
 * the portal's `ChildCard` adds on top — the same pairing used in
 * `client-admin/src/routes/portal/index.tsx`.
 */
function CardHoverDemo() {
  return (
    <div className="flex flex-col gap-2">
      <div className="w-fit rounded-lg border border-border-subtle bg-card p-4 shadow-e1 transition-[box-shadow,border-color] duration-(--motion-duration-fast) ease-(--motion-ease-standard) hover:shadow-e2">
        Fatima Rahman — Class 8B
      </div>
      <p className="text-caption text-muted-foreground">
        Hover — <code>Card</code>&rsquo;s base transition plus the portal&rsquo;s{' '}
        <code>hover:shadow-e2</code>.
      </p>
    </div>
  );
}

export const Motion: Story = {
  render: () => (
    <div className="flex flex-col gap-8">
      <p className="text-body text-muted-foreground">
        Three durations, two curves — every animated thing in the product picks one of each. Values
        below are read from the compiled stylesheet, not typed here.
      </p>
      <div className="flex flex-col gap-6">
        {DURATIONS.map((d) => (
          <DurationTile key={d.label} {...d} />
        ))}
      </div>
      <EasingDemo />
      <TokenConsumersTable />
      <div className="flex flex-col gap-6 sm:flex-row sm:gap-12">
        <NavItemDemo />
        <CardHoverDemo />
      </div>
    </div>
  ),
};

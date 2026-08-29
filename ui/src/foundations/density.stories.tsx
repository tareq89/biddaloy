/**
 * Foundations story for the two density modes (design contract §6): compact
 * (staff routes, the default by ABSENCE — no `data-density` attribute at
 * all) and comfortable (`/portal`, auth screens — `data-density="comfortable"`
 * lifts every control to the 44px WCAG 2.2 SC 2.5.5 target in one
 * declaration). `ui/src/styles/density.spec.ts` already pins the per-variant
 * class mapping from source text; this page is the live, visual counterpart
 * — the two numbers each column reports (`--control-h`, `--target-inset`)
 * are read off the DOM via `getComputedStyle`, not re-typed from §6's table.
 *
 * `data-density` verified present on this branch before writing this file —
 * `ui/src/hooks/use-density.ts`, `ui/src/styles/globals.css`'s
 * `[data-density='comfortable']` block, and `ui/src/styles/density.spec.ts`
 * all landed in [8.13.8]/#349, which this ticket depends on.
 *
 * `parameters: { density: 'both' }` opts this story out of the toolbar's own
 * `density` global — see `.storybook/preview.tsx`'s decorator comment and
 * `button.stories.tsx`'s own `Density` story, the precedent this one
 * follows. Without the opt-out the toolbar's wrapper would sit above both
 * columns below, and the compact column — which demonstrates compact BY
 * ABSENCE of the attribute — would inherit `--control-h` from it and stop
 * being compact.
 *
 * No table/row-height story here: §6's `--row-h` has no shipped consumer
 * yet (no `/portal` route renders `DataTable` today) — inventing one to
 * demonstrate a variable nothing reads would be exactly the
 * hand-maintained-and-therefore-driftable content this ticket exists to
 * avoid.
 */
import type { Meta, StoryObj } from '@storybook/react-vite';
import { useEffect, useRef, useState } from 'react';

import { Button } from '../components/button';
import { Checkbox } from '../components/checkbox';
import { Input } from '../components/input';

const meta: Meta = {
  title: 'Foundations/Density',
};

export default meta;
type Story = StoryObj;

function DensityColumn({ label, density }: { label: string; density: 'comfortable' | undefined }) {
  const ref = useRef<HTMLDivElement>(null);
  const [controlH, setControlH] = useState('');
  const [targetInset, setTargetInset] = useState('');

  useEffect(() => {
    if (!ref.current) return;
    const styles = getComputedStyle(ref.current);
    setControlH(styles.getPropertyValue('--control-h').trim());
    setTargetInset(styles.getPropertyValue('--target-inset').trim());
  }, []);

  return (
    <div
      ref={ref}
      data-density={density}
      className="flex flex-1 flex-col gap-4 rounded-lg border border-border-subtle bg-card p-4"
    >
      <p className="text-label">{label}</p>
      <p className="text-caption text-muted-foreground">
        <code>--control-h</code>: {controlH || 'unset — each control falls back to its own size'}
        <br />
        <code>--target-inset</code>:{' '}
        {targetInset || 'unset — each axis falls back to its own inset'}
      </p>
      <div className="flex flex-wrap items-center gap-3">
        <Input aria-label="Guardian phone number" placeholder="01XXXXXXXXX" className="max-w-40" />
        <Button size="default">Save</Button>
      </div>
      {/* `Checkbox` is a bare Radix control — its own `aria-label` is the
       * accessible name, per `ui/CONTRIBUTING.md`'s worked example, so this
       * is a plain `div` rather than a `<label>` wrapping it (which would
       * try, and fail, to associate a non-native control). */}
      <div className="flex items-center gap-2 text-body">
        <Checkbox aria-label="Send SMS receipt" defaultChecked />
        <span>Send SMS receipt</span>
      </div>
    </div>
  );
}

export const Modes: Story = {
  parameters: {
    // Read by the density decorator in `.storybook/preview.tsx`: stands the
    // toolbar's own `density` global down for this story — see the file
    // header for why.
    density: 'both',
  },
  render: () => (
    <div className="flex flex-col gap-6">
      <p className="text-body text-muted-foreground">
        Same three controls, same markup, same component props — only the ancestor&apos;s{' '}
        <code>data-density</code> attribute differs. No component here takes a density prop.
      </p>
      <div className="flex flex-col gap-4 sm:flex-row">
        <DensityColumn
          label="Compact — staff routes (no data-density attribute)"
          density={undefined}
        />
        <DensityColumn
          label="Comfortable — /portal and auth (44px targets)"
          density="comfortable"
        />
      </div>
    </div>
  ),
};

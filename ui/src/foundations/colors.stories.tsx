/**
 * Foundations story for the colour system: the raw `neutral`/`brand` scales,
 * the semantic role tokens built from them (design contract §3.3), and the
 * four fee-status colours (§3.5). Like `borders.stories.tsx` and
 * `elevation.stories.tsx`, nothing here is a hand-copied hex — every swatch
 * label and every contrast ratio is read from the *compiled* CSS custom
 * property via `useComputedVar` (`getComputedStyle` on
 * `document.documentElement`) and run through `contrastRatio` (`./contrast.ts`)
 * at render time, so a token drift shows up here the same way it would break
 * `check-contrast.mjs`.
 *
 * Every swatch's `className` is written out as a full literal Tailwind
 * utility string (`bg-neutral-200`, never a template-built `bg-neutral-${n}`)
 * — see the header comment in `tailwind.preset.ts` on why: Tailwind v4 only
 * emits a `@theme` custom property for a class its scanner can see as a
 * literal string, so a dynamically-built class name can silently compile to
 * nothing.
 */
import type { Meta, StoryObj } from '@storybook/react-vite';
import { AlertTriangle, CheckCircle2, CircleDashed, Clock } from 'lucide-react';
import type { ComponentType } from 'react';

import { darkDecorator, darkDecoratorParameters } from '../../.storybook/dark-decorator';

import { contrastRatio, normalizeHex } from './contrast';
import { useComputedVar } from './use-computed-var';

const meta: Meta = {
  title: 'Foundations/Colors',
};

export default meta;
type Story = StoryObj;

/** Raw neutral scale — decorative/structural, `check-raw-palette.mjs`
 * exempts these names because the preset (not Tailwind's defaults) owns
 * them. Order matches `tailwind.preset.ts`'s `neutral` export. */
const NEUTRAL_SWATCHES = [
  { label: 'neutral-0', className: 'bg-neutral-0', varName: '--color-neutral-0' },
  { label: 'neutral-50', className: 'bg-neutral-50', varName: '--color-neutral-50' },
  { label: 'neutral-100', className: 'bg-neutral-100', varName: '--color-neutral-100' },
  { label: 'neutral-200', className: 'bg-neutral-200', varName: '--color-neutral-200' },
  { label: 'neutral-400', className: 'bg-neutral-400', varName: '--color-neutral-400' },
  { label: 'neutral-500', className: 'bg-neutral-500', varName: '--color-neutral-500' },
  { label: 'neutral-600', className: 'bg-neutral-600', varName: '--color-neutral-600' },
  { label: 'neutral-700', className: 'bg-neutral-700', varName: '--color-neutral-700' },
  { label: 'neutral-900', className: 'bg-neutral-900', varName: '--color-neutral-900' },
  { label: 'neutral-950', className: 'bg-neutral-950', varName: '--color-neutral-950' },
] as const;

/** Brand ramp — order matches `tailwind.preset.ts`'s `brand` export. */
const BRAND_SWATCHES = [
  { label: 'brand-50', className: 'bg-brand-50', varName: '--color-brand-50' },
  { label: 'brand-100', className: 'bg-brand-100', varName: '--color-brand-100' },
  { label: 'brand-400', className: 'bg-brand-400', varName: '--color-brand-400' },
  { label: 'brand-600', className: 'bg-brand-600', varName: '--color-brand-600' },
  { label: 'brand-700', className: 'bg-brand-700', varName: '--color-brand-700' },
] as const;

function PaletteChip({
  label,
  className,
  varName,
}: {
  label: string;
  className: string;
  varName: string;
}) {
  const hex = normalizeHex(useComputedVar(varName));
  return (
    <div className="flex flex-col items-center gap-1">
      <div className={`size-12 rounded-md border border-border-subtle ${className}`} />
      <p className="text-caption text-muted-foreground">{label}</p>
      <p className="text-caption text-muted-foreground">{hex || '…'}</p>
    </div>
  );
}

/**
 * One fg/bg pair with its ratio computed live and checked against `min`
 * (4.5:1 for text, per WCAG 2.2 SC 1.4.3; 3:1 for the functional border,
 * per SC 1.4.11). `swatchClassName` is the literal utility pair a real
 * component would render — the same classes prove the swatch and the ratio
 * agree, rather than the ratio being computed from one source and the
 * swatch painted from another.
 */
function ContrastRow({
  label,
  fgVar,
  bgVar,
  min,
  swatchClassName,
  Icon,
}: {
  label: string;
  fgVar: string;
  bgVar: string;
  min: number;
  swatchClassName: string;
  Icon?: ComponentType<{ className?: string }>;
}) {
  const fg = normalizeHex(useComputedVar(fgVar));
  const bg = normalizeHex(useComputedVar(bgVar));
  const ratio = fg && bg ? contrastRatio(fg, bg) : null;
  const passes = ratio !== null && ratio >= min;

  return (
    <div className="flex items-center gap-3">
      <div
        className={`flex size-14 shrink-0 items-center justify-center rounded-md border border-border-subtle text-label font-medium ${swatchClassName}`}
      >
        {Icon ? <Icon className="size-5" /> : 'Aa'}
      </div>
      <div className="flex flex-col">
        <p className="text-label">{label}</p>
        <p className="text-caption text-muted-foreground">
          {fg || '…'} on {bg || '…'} — {ratio ? ratio.toFixed(2) : '…'}:1, needs {min}:1{' '}
          {ratio ? (
            <span className={passes ? 'text-status-paid-fg' : 'text-status-overdue-fg'}>
              {passes ? 'Pass' : 'Fail'}
            </span>
          ) : null}
        </p>
      </div>
    </div>
  );
}

function ColorSystem() {
  return (
    <div className="flex flex-col gap-8">
      <p className="text-body text-muted-foreground">
        Every hex below and every ratio is read from the compiled stylesheet at render time (
        <code>getComputedStyle</code> on the real CSS custom property), never re-typed — the same
        contract <code>check-contrast.mjs</code> enforces at build time.
      </p>

      <div className="flex flex-col gap-2">
        <p className="text-caption text-muted-foreground">
          Neutral scale — structural and decorative. Fixed <em>value</em> across themes; see the
          role tokens below for what switches with theme.
        </p>
        <div className="flex flex-wrap gap-4">
          {NEUTRAL_SWATCHES.map((s) => (
            <PaletteChip key={s.label} {...s} />
          ))}
        </div>
      </div>

      <div className="flex flex-col gap-2">
        <p className="text-caption text-muted-foreground">
          Brand ramp — <code>brand-600</code> is the light-mode interactive colour,{' '}
          <code>brand-400</code> the dark-mode one.
        </p>
        <div className="flex flex-wrap gap-4">
          {BRAND_SWATCHES.map((s) => (
            <PaletteChip key={s.label} {...s} />
          ))}
        </div>
      </div>

      <div className="flex flex-col gap-3">
        <p className="text-caption text-muted-foreground">
          Role tokens — what a component should reach for (<code>bg-background</code>,{' '}
          <code>text-foreground</code>, …), not the raw scale. Fixed <em>meaning</em> across themes:
          this same JSX renders correct values under both <code>Colors</code> and{' '}
          <code>ColorsDark</code> below because the underlying CSS custom property, not this file,
          is what changes.
        </p>
        <ContrastRow
          label="Primary text on page ground"
          fgVar="--color-text-primary"
          bgVar="--color-bg"
          min={4.5}
          swatchClassName="bg-background text-foreground"
        />
        <ContrastRow
          label="Secondary text on page ground"
          fgVar="--color-text-secondary"
          bgVar="--color-bg"
          min={4.5}
          swatchClassName="bg-background text-muted-foreground"
        />
        <ContrastRow
          label="Primary text on card surface"
          fgVar="--color-text-primary"
          bgVar="--color-surface"
          min={4.5}
          swatchClassName="bg-card text-card-foreground"
        />
        <ContrastRow
          label="Functional border on page ground (UI component minimum)"
          fgVar="--color-border-functional"
          bgVar="--color-bg"
          min={3}
          swatchClassName="border-2 border-border-functional bg-background"
        />
        <ContrastRow
          label="Brand text on page ground"
          fgVar="--color-brand"
          bgVar="--color-bg"
          min={4.5}
          swatchClassName="bg-background text-primary"
        />
      </div>

      <div className="flex flex-col gap-3">
        <p className="text-caption text-muted-foreground">
          Status colours (§3.5) — four tones, each a colour <em>and</em> a distinct icon shape (
          <code>StatusBadge</code>&apos;s own rule: colour alone never carries meaning).
        </p>
        <ContrastRow
          label="Paid"
          fgVar="--color-status-paid-fg"
          bgVar="--color-status-paid-bg"
          min={4.5}
          swatchClassName="bg-status-paid-bg text-status-paid-fg"
          Icon={CheckCircle2}
        />
        <ContrastRow
          label="Partial"
          fgVar="--color-status-partial-fg"
          bgVar="--color-status-partial-bg"
          min={4.5}
          swatchClassName="bg-status-partial-bg text-status-partial-fg"
          Icon={CircleDashed}
        />
        <ContrastRow
          label="Due"
          fgVar="--color-status-due-fg"
          bgVar="--color-status-due-bg"
          min={4.5}
          swatchClassName="bg-status-due-bg text-status-due-fg"
          Icon={Clock}
        />
        <ContrastRow
          label="Overdue"
          fgVar="--color-status-overdue-fg"
          bgVar="--color-status-overdue-bg"
          min={4.5}
          swatchClassName="bg-status-overdue-bg text-status-overdue-fg"
          Icon={AlertTriangle}
        />
      </div>
    </div>
  );
}

/** The full system in the default (light) theme. */
export const Colors: Story = {
  render: () => <ColorSystem />,
};

/**
 * The same system under `:root[data-theme="dark"]`. No branch in
 * `ColorSystem` itself keys off "dark" — every value shown here is read live
 * from whichever theme the document is actually in, which is the whole
 * point: this story only differs from `Colors` in which decorator wraps it.
 */
export const ColorsDark: Story = {
  // [8.13.12]: see `borders.stories.tsx`'s `RolesDark` for why this is
  // required alongside `darkDecorator`, not merely belt-and-braces.
  parameters: darkDecoratorParameters,
  decorators: [darkDecorator],
  render: () => <ColorSystem />,
};

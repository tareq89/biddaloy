import { cva, type VariantProps } from 'class-variance-authority';
import { Slot } from 'radix-ui';
import * as React from 'react';

import { cn } from './lib/utils';

// An explicit property list rather than `transition-all`: only colour,
// background, border colour, box-shadow and opacity should travel.
// `transition-all` also animated `active:translate-y-px`, which turned the
// 1px press into a visible slide instead of the instant tactile response it
// is meant to be, and animated layout properties (width, padding) on any
// consumer that changes them — paying layout+paint cost every frame for a
// change nobody asked to animate.
//
// `opacity` is in the list because `disabled:opacity-50` on the base class
// is a real state change: a submit button going disabled mid-interaction
// should fade, not snap. `transform` is deliberately out, per above.
//
// [8.13.10]: `disabled:opacity-50` on solid-filled text (`default`,
// `secondary`) drops already-borderline text below a readable ratio — it
// halves the whole rendered button, background and text together, rather
// than lightening a background behind text that stays full-strength. Those
// two variants override it below with an explicit, opaque
// `disabled:bg-muted disabled:text-muted-foreground` pair (6.92:1,
// CONTRAST_PAIRS' existing 'muted-foreground on muted' row) plus
// `disabled:opacity-100` to cancel this base rule. `outline`/`ghost`/
// `destructive`/`link` keep the opacity approach: their disabled state dims
// a border/text pair that is not filled the way `default`/`secondary` are,
// and an icon-only button in any variant is graphical, not text, so SC
// 1.4.11's 3:1 (not 4.5:1) applies and opacity-50 does not put it at risk
// the way it does 4.5:1 body text.
//
// Written without the literal utility syntax on purpose — Tailwind's scanner
// reads comments as plain text, so spelling a bracketed transition utility
// here would compile a real, junk rule into every bundle.
//
// [8.13.10]: hover/active/focus now carry an explicit duration —
// `duration-(--motion-duration-fast)` (120ms) — instead of falling back to
// the browser default. Arbitrary custom-property syntax because `--motion-*`
// is not one of Tailwind v4's utility namespaces (see the long note on
// `motion` in `tailwind.preset.ts`), so no `duration-fast` utility exists.
//
// Focus treatment: one two-tone offset ring everywhere, replacing the old
// `focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50`
// (brand-on-brand at 50% alpha — nearly invisible on the brand-filled
// button itself). `ring-2 ring-ring ring-offset-2 ring-offset-background` is
// full-alpha ring colour plus a ground-coloured gap: the gap is what makes
// it visible against a brand-600 button — ring `#4a3fd4` on the `#f8fafc`
// offset is 6.80:1, the offset on the button's `#4a3fd4` fill is 6.80:1
// back. Dark: ring resolves to brand-400 `#8f96f4`, offset to `#0f172a` —
// 6.66:1 both directions. `aria-invalid`'s destructive ring block is
// untouched — it is already a distinct treatment.
const buttonVariants = cva(
  "group/button inline-flex shrink-0 items-center justify-center rounded-lg border border-transparent bg-clip-padding text-sm font-medium whitespace-nowrap transition-[color,background-color,border-color,box-shadow,opacity] duration-(--motion-duration-fast) ease-(--motion-ease-standard) outline-none select-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background active:not-aria-[haspopup]:translate-y-px disabled:pointer-events-none disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 dark:aria-invalid:border-destructive/50 dark:aria-invalid:ring-destructive/40 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        // Hover recalibrated per design contract §3.2: `brand-700` on white
        // is 8.88:1 (verified in CONTRAST_PAIRS as the symmetric twin of
        // 'brand-700 text on white'). Dark mode keeps the pre-existing
        // opacity-based hover rather than the same literal: `primary`
        // resolves to `brand-400` in dark, whose foreground is overridden to
        // `neutral-900` (near-black) for contrast on the light-purple fill —
        // a literal `brand-700` hover under that near-black text measures
        // only ~2:1, while the opacity blend already in place measures
        // ~4.7:1. Recalibrating dark hover to a new literal is out of this
        // ticket's scope (dark mode has no toggle yet, #353); this keeps its
        // already-correct behaviour unchanged.
        default:
          'bg-primary text-primary-foreground hover:bg-brand-700 dark:hover:bg-primary/80 disabled:bg-muted disabled:text-muted-foreground disabled:opacity-100',
        outline:
          'border-border bg-card hover:bg-muted hover:text-foreground aria-expanded:bg-muted aria-expanded:text-foreground dark:border-input dark:bg-input/30 dark:hover:bg-input/50',
        // [8.13.10]: was `bg-secondary text-secondary-foreground` on a
        // `border-transparent` base with a `color-mix()` hover that
        // referenced `--secondary`/`--foreground` — neither custom property
        // is declared anywhere (only the `--color-*` forms are), so the
        // `color-mix()` was invalid at computed-value time and hover painted
        // nothing. `--color-secondary`/`--color-secondary-foreground` are
        // re-pointed off `--color-surface` in globals.css (was white text on
        // white — ~1.00:1, SC 1.4.11) to brand-50/brand-700, so this variant
        // now needs a real border instead of the base's transparent one, and
        // a real hover instead of the dead color-mix.
        secondary:
          'bg-secondary text-secondary-foreground border-border hover:bg-brand-100 aria-expanded:bg-brand-100 dark:hover:bg-secondary dark:aria-expanded:bg-secondary aria-expanded:text-secondary-foreground disabled:bg-muted disabled:text-muted-foreground disabled:opacity-100',
        ghost:
          'hover:bg-muted hover:text-foreground aria-expanded:bg-muted aria-expanded:text-foreground dark:hover:bg-muted/50',
        destructive:
          'bg-destructive/10 text-destructive hover:bg-destructive/20 focus-visible:border-destructive/40 focus-visible:ring-destructive/20 dark:bg-destructive/20 dark:hover:bg-destructive/30 dark:focus-visible:ring-destructive/40',
        link: 'text-primary underline-offset-4 hover:underline',
      },
      size: {
        default:
          'h-[var(--control-h,2rem)] gap-1.5 px-2.5 has-data-[icon=inline-end]:pr-2 has-data-[icon=inline-start]:pl-2',
        xs: "h-[var(--control-h,1.5rem)] gap-1 rounded-[min(var(--radius-md),10px)] px-2 text-xs in-data-[slot=button-group]:rounded-lg has-data-[icon=inline-end]:pr-1.5 has-data-[icon=inline-start]:pl-1.5 [&_svg:not([class*='size-'])]:size-3",
        sm: "h-[var(--control-h,1.75rem)] gap-1 rounded-[min(var(--radius-md),12px)] px-2.5 text-[0.8rem] in-data-[slot=button-group]:rounded-lg has-data-[icon=inline-end]:pr-1.5 has-data-[icon=inline-start]:pl-1.5 [&_svg:not([class*='size-'])]:size-3.5",
        lg: 'h-[var(--control-h,2.25rem)] gap-1.5 px-2.5 has-data-[icon=inline-end]:pr-2 has-data-[icon=inline-start]:pl-2',
        icon: 'size-[var(--control-h,2rem)]',
        'icon-xs':
          "size-[var(--control-h,1.5rem)] rounded-[min(var(--radius-md),10px)] in-data-[slot=button-group]:rounded-lg [&_svg:not([class*='size-'])]:size-3",
        'icon-sm':
          'size-[var(--control-h,1.75rem)] rounded-[min(var(--radius-md),12px)] in-data-[slot=button-group]:rounded-lg',
        'icon-lg': 'size-[var(--control-h,2.25rem)]',
      },
    },
    defaultVariants: {
      variant: 'default',
      size: 'default',
    },
  },
);

function Button({
  className,
  variant = 'default',
  size = 'default',
  asChild = false,
  ...props
}: React.ComponentProps<'button'> &
  VariantProps<typeof buttonVariants> & {
    asChild?: boolean;
  }) {
  const Comp = asChild ? Slot.Root : 'button';

  return (
    <Comp
      data-slot="button"
      data-variant={variant}
      data-size={size}
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  );
}

export { Button, buttonVariants };

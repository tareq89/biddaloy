import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, userEvent, within } from 'storybook/test';

import { darkDecorator, darkDecoratorParameters } from '../../.storybook/dark-decorator';
import { rtlDecorator } from '../../.storybook/rtl-decorator';
import { buttonVariants } from '../primitives/button';

import { Button } from './button';

const meta: Meta<typeof Button> = {
  title: 'Components/Button',
  component: Button,
  tags: ['autodocs'],
  args: { children: 'Save changes' },
};

export default meta;
type Story = StoryObj<typeof Button>;

export const Default: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const button = canvas.getByRole('button', { name: 'Save changes' });
    await userEvent.click(button);
    await expect(button).toBeEnabled();
  },
};

export const Loading: Story = {
  args: { loading: true },
};

export const Disabled: Story = {
  args: { disabled: true },
};

/** Stands in for this issue's "empty" state category — an icon-only button
 * has no visible label, the closest analog `Button` has to "empty". The
 * `aria-label` is required by the type; try removing it in this story's
 * args to see the compile error the wrapper's job is to produce. */
export const IconOnly: StoryObj<typeof Button> = {
  args: {
    iconOnly: true,
    'aria-label': 'Delete row',
    children: <span aria-hidden="true">×</span>,
  },
};

/** Stands in for this issue's "error" state category — `destructive` is
 * this design system's error/danger variant. */
export const Error: Story = {
  args: { variant: 'destructive', children: 'Delete student record' },
};

/** Neither of this package's two supported locales (`en`, `bn`) is RTL —
 * see `.storybook/locale.tsx` — so this forces `dir="rtl"` directly rather
 * than switching locale, to prove the component's own layout (icon/label
 * order, focus ring, spacing) holds up under a bidi flip regardless of
 * whether a real RTL locale exists yet. */
export const RightToLeft: Story = {
  decorators: [rtlDecorator],
};

/**
 * Density ([8.13.8], design contract section 6). The same eight size
 * variants rendered twice: once with no `data-density` attribute, which is
 * how every staff route renders and where each variant keeps its own
 * historical height (24/28/32/36 px), and once under
 * `data-density="comfortable"`, which is how `/portal` and the auth screens
 * render and where all eight collapse onto a single 44 px target — WCAG 2.2
 * SC 2.5.5 has no "small control" exception.
 *
 * Nothing in this story passes a size-related prop to change density. That
 * is the point: density is an inherited CSS custom property set on an
 * ancestor, so `Button`'s public API is identical in both columns. The
 * toolbar's Density control switches the whole Storybook canvas the same
 * way; this story shows both at once so the difference is comparable
 * side by side.
 */
export const Density: StoryObj<typeof Button> = {
  parameters: {
    // Read by the density decorator in `.storybook/preview.tsx`: it makes
    // the toolbar global stand down for this story. Otherwise the toolbar's
    // wrapper would sit above both columns, and the compact column — which
    // demonstrates compact-BY-ABSENCE, i.e. no attribute at all — would
    // inherit `--control-h` from it and stop being compact.
    density: 'both',
  },
  render: () => {
    const sizes = ['xs', 'sm', 'default', 'lg'] as const;
    const iconSizes = ['icon-xs', 'icon-sm', 'icon', 'icon-lg'] as const;
    const column = (label: string, density: string | undefined) => (
      <div data-density={density} className="flex flex-col gap-3">
        <p className="text-sm font-medium text-muted-foreground">{label}</p>
        <div className="flex flex-wrap items-center gap-2">
          {sizes.map((size) => (
            <Button key={size} size={size}>
              {size}
            </Button>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {iconSizes.map((size) => (
            <Button key={size} size={size} iconOnly aria-label={`Example ${size} button`}>
              <span aria-hidden="true">×</span>
            </Button>
          ))}
        </div>
      </div>
    );
    return (
      <div className="flex flex-col gap-8">
        {column('Compact — staff routes (no data-density attribute)', undefined)}
        {column('Comfortable — /portal and auth (44px targets)', 'comfortable')}
      </div>
    );
  },
};

// Deriving this from `buttonVariants` itself (`Parameters<typeof
// buttonVariants>[0]['variant']`) is the more DRY option, but this
// workspace's installed TypeScript does not resolve cva's generic call
// signature cleanly (`ui/package.json` pins `^6`; only 5.9.x is actually
// installed here), which turns every downstream use of that derived type
// into an unchecked `any`. A plain literal union — these six keys are
// `button.tsx`'s own `variants.variant` object keys — keeps this file
// type-checked instead of silently unchecked; `buttonVariantsAsString`
// below is still the one place that reads the real CSS, so a recalibrated
// hover/focus value still shows up here without edits.
type ButtonVariant = 'default' | 'outline' | 'secondary' | 'ghost' | 'destructive' | 'link';

const STATE_MATRIX_VARIANTS: readonly ButtonVariant[] = [
  'default',
  'outline',
  'secondary',
  'ghost',
  'destructive',
  'link',
];

// See the comment on `ButtonVariant` above for why this call is typed by
// hand instead of through `typeof buttonVariants`.
const buttonVariantsAsString = buttonVariants as (opts: { variant: ButtonVariant }) => string;

/**
 * Reads the real target classes for a pseudo-state straight off
 * `buttonVariants` — the same source of truth the component itself
 * compiles from — rather than hand-copying a colour into the story. If
 * `button.tsx` ever recalibrates a variant's hover/focus value, this matrix
 * updates with it instead of silently drifting out of sync.
 *
 * Tries each prefix in order and returns the first match: dark hover
 * (`dark:hover:`) falls back to the light rule (`hover:`) for variants
 * that don't override it for dark mode (ghost, outline, secondary, etc.).
 */
function forcedStateClasses(variant: ButtonVariant, ...prefixes: string[]): string {
  const classes = buttonVariantsAsString({ variant }).split(/\s+/);
  for (const prefix of prefixes) {
    const matches = classes
      .filter((cls) => cls.startsWith(prefix))
      .map((cls) => cls.slice(prefix.length));
    if (matches.length > 0) return matches.join(' ');
  }
  return '';
}

/**
 * State matrix, design contract §3.2 ([8.13.10]). Six variants × five
 * states, rendered in one static grid rather than driven live: `:hover`,
 * `:focus-visible` and `:active` are each exclusive to a single element per
 * document, so a real pointer/keyboard `play()` could light up at most one
 * cell of thirty at a time, not the whole grid at once.
 *
 * `hover` and `focus` cells apply the exact classes `forcedStateClasses`
 * reads back off `buttonVariants` for that pseudo-state, unconditionally,
 * so what's on screen is the design system's own token, not a guess. The
 * `focus` cell in particular is genuinely representative: the two-tone
 * offset ring has no pointer/hover interaction to fight with, so applying
 * `ring-2 ring-ring ring-offset-2 ring-offset-background` directly renders
 * pixel-identical to a real `:focus-visible`.
 *
 * `active` has no variant-specific colour (only the shared
 * `active:not-aria-[haspopup]:translate-y-px` on the base string, which is
 * not extractable by prefix the same way — `not-aria-[haspopup]` is itself
 * a variant), so it is applied as the one literal in this file:
 * `translate-y-px`, matching that base rule exactly. `disabled` needs no
 * forcing at all — it's the real `disabled` prop, so `:disabled` styling is
 * genuinely live.
 */
function renderButtonStateMatrix(theme: 'light' | 'dark') {
  // Dark mode only re-points `default`'s hover (an opacity blend, kept
  // deliberately different from light's `brand-700` literal — see the
  // comment on the `default` variant in `button.tsx`); every other variant
  // has no `dark:hover:` override and falls back to its one `hover:` rule,
  // which resolves through theme-aware tokens either way.
  const hoverPrefixes = theme === 'dark' ? ['dark:hover:', 'hover:'] : ['hover:'];
  return (
    <table className="border-separate border-spacing-2">
      <thead>
        <tr>
          <th className="text-start text-sm font-medium text-muted-foreground">Variant</th>
          <th className="text-start text-sm font-medium text-muted-foreground">Rest</th>
          <th className="text-start text-sm font-medium text-muted-foreground">Hover</th>
          <th className="text-start text-sm font-medium text-muted-foreground">Focus</th>
          <th className="text-start text-sm font-medium text-muted-foreground">Active</th>
          <th className="text-start text-sm font-medium text-muted-foreground">Disabled</th>
        </tr>
      </thead>
      <tbody>
        {STATE_MATRIX_VARIANTS.map((variant) => (
          <tr key={variant}>
            <td className="pe-4 text-sm text-muted-foreground">{variant}</td>
            <td>
              <Button variant={variant}>{variant}</Button>
            </td>
            <td>
              <Button variant={variant} className={forcedStateClasses(variant, ...hoverPrefixes)}>
                {variant}
              </Button>
            </td>
            <td>
              <Button variant={variant} className={forcedStateClasses(variant, 'focus-visible:')}>
                {variant}
              </Button>
            </td>
            <td>
              <Button variant={variant} className="translate-y-px">
                {variant}
              </Button>
            </td>
            <td>
              <Button variant={variant} disabled>
                {variant}
              </Button>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export const States: StoryObj<typeof Button> = {
  tags: ['!autodocs'],
  render: () => renderButtonStateMatrix('light'),
};

/** Same matrix, dark half of every token pair. Its own story rather than a
 * column of `States`: `darkDecorator` sets `data-theme="dark"` on
 * `<html>`, which cannot be scoped to half of one story's markup — see the
 * decorator's own doc comment for why `autodocs` is excluded here too. */
export const StatesDark: StoryObj<typeof Button> = {
  tags: ['!autodocs'],
  decorators: [darkDecorator],
  parameters: darkDecoratorParameters,
  render: () => renderButtonStateMatrix('dark'),
};

import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, userEvent, within } from 'storybook/test';

import { rtlDecorator } from '../../.storybook/rtl-decorator';

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

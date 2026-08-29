/**
 * Foundations story for the two border roles added in [8.13.4] (design
 * contract §4). There is no component here on purpose: this ticket registers
 * tokens and changes no component, so the demos below are plain `div`s that
 * show what each role looks like and, just as importantly, spell the utility
 * names out in full.
 *
 * Naming, because it is easy to get wrong: Tailwind v4 derives the utility
 * from the token name minus the `--color-` prefix. `--color-border-subtle`
 * is therefore `border-border-subtle`, not `border-subtle`. The shorter
 * spelling matches no colour utility at all, so the element keeps its
 * `currentColor` (black) border and the mistake looks like a styling choice
 * rather than a bug.
 */
import type { Meta, StoryObj } from '@storybook/react-vite';

import { darkDecorator, darkDecoratorParameters } from '../../.storybook/dark-decorator';

/** The subtle-vs-functional rule, in one sentence. Rendered in the story
 * canvas rather than parked in `parameters.docs.description.component`,
 * because this file deliberately does **not** carry `tags: ['autodocs']`
 * (see the note on `meta` below) and an autodocs-only description would
 * therefore be invisible. */
const ROLE_RULE =
  'Would a user who cannot see this line lose information? Yes → functional (must clear 3:1). No → subtle (exempt from WCAG SC 1.4.11).';

/**
 * No `tags: ['autodocs']` here, unlike most stories in this package, and that
 * is deliberate: autodocs renders every story of a file on one page, and
 * `RolesDark` flips `document.documentElement.dataset.theme` — a *document*-
 * level mutation, the only way to reach `:root[data-theme="dark"]`. On a docs
 * page that would drag the light `Roles` story, the prose and the Storybook
 * chrome into dark mode too, which is exactly the side-by-side comparison this
 * file exists to show. Turning autodocs on here means first making
 * `darkDecorator` scope-safe.
 */
const meta: Meta = {
  title: 'Foundations/Borders',
};

export default meta;
type Story = StoryObj;

function BorderRoles() {
  return (
    <div className="flex flex-col gap-6">
      <p className="text-body text-muted-foreground">
        Two border roles. <code>border-border-subtle</code> (neutral-200 light / neutral-700 dark)
        is decoration — card outlines, dividers, table rules. <code>border-border-functional</code>{' '}
        (neutral-500, both themes) marks where a control begins and ends. {ROLE_RULE}
      </p>

      <div className="flex flex-col gap-2">
        <p className="text-caption text-muted-foreground">
          Decorative — <code>border border-border-subtle</code>. Card outlines, dividers, table
          rules. Exempt from 3:1.
        </p>
        <div className="rounded-lg border border-border-subtle bg-card p-4">
          Total outstanding — ৳ 11,000 across 2 of 3 children.
        </div>
        <hr className="border-border-subtle" />
      </div>

      <div className="flex flex-col gap-2">
        <p className="text-caption text-muted-foreground">
          Functional — <code>border border-border-functional</code>. Inputs, selects, checkboxes,
          anything focus-adjacent or conveying state. Must clear 3:1.
        </p>
        <div className="rounded-md border border-border-functional bg-card px-3 py-2 text-muted-foreground">
          Guardian phone number
        </div>
      </div>

      <p className="text-caption text-muted-foreground">
        The utility is <code>border-border-subtle</code>, never <code>border-subtle</code> — the
        short spelling compiles to no colour utility and leaves a black <code>currentColor</code>{' '}
        hairline.
      </p>
    </div>
  );
}

/** Both roles side by side in the default (light) theme. */
export const Roles: Story = {
  render: () => <BorderRoles />,
};

/**
 * The same two roles under `:root[data-theme="dark"]`, where subtle moves to
 * `neutral-700` while functional stays on `neutral-500`.
 */
export const RolesDark: Story = {
  // [8.13.12]: required alongside `darkDecorator`, not belt-and-braces —
  // without it the toolbar-driven `theme` global's own effect undoes this
  // decorator's attribute write. Why: docs/architecture/09-design-direction.md
  // §3.4.3.
  parameters: darkDecoratorParameters,
  decorators: [darkDecorator],
  render: () => <BorderRoles />,
};

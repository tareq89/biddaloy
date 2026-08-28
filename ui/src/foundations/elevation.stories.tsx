/**
 * Foundations story for the three elevation steps added in [8.13.5] (design
 * contract §5). As with `borders.stories.tsx` there is no component here on
 * purpose: [8.13.5] registered the tokens and changed no component. The six
 * existing `shadow-sm`/`shadow-md`/`shadow-lg` call sites moved to `shadow-e*`
 * in [8.13.9], which also added the `ui/scripts/check-raw-palette.mjs` gate
 * that now fails the build on Tailwind's raw shadow scale. These demos stay
 * plain `div`s that show what each step looks like and spell the utility name
 * out in full.
 *
 * (That sentence naming `shadow-sm` is deliberate, and is a live negative test
 * of the gate: it strips comments before scanning, so documentation may say
 * what it means instead of being reworded around a regex.)
 *
 * The dark story is the one worth looking at. `shadow-e*` resolves through a
 * runtime `--elevation-*` custom property (see the note in globals.css) —
 * without that indirection the dark values would be dead CSS and `ScaleDark`
 * would render identically to `Scale`. This file is the visual proof that it
 * does not.
 */
import type { Meta, StoryObj } from '@storybook/react-vite';

import { darkDecorator, darkDecoratorParameters } from '../../.storybook/dark-decorator';

/**
 * No `tags: ['autodocs']` here, deliberately, for the same reason
 * `borders.stories.tsx` omits it: `ScaleDark` uses `darkDecorator`, which
 * flips `document.documentElement.dataset.theme` — a *document*-level
 * mutation that cannot be scoped to one story's subtree. Autodocs renders
 * every story of a file on one page, so the dark story would drag the light
 * `Scale` story, the prose and the Storybook chrome into dark mode with it,
 * destroying the side-by-side comparison this file exists to show. Turning
 * autodocs on here means first making `darkDecorator` scope-safe.
 */
const meta: Meta = {
  title: 'Foundations/Elevation',
};

export default meta;
type Story = StoryObj;

/** Each step and the job it is for — §5's table, in the order it appears. */
const STEPS = [
  { utility: 'shadow-e1', job: 'cards, resting panels, tabs' },
  { utility: 'shadow-e2', job: 'dropdown, select, popover' },
  { utility: 'shadow-e3', job: 'dialog, drawer, toast, skip-link' },
] as const;

function ElevationScale({ dark = false }: { dark?: boolean }) {
  return (
    <div className="flex flex-col gap-6">
      <p className="text-body text-muted-foreground">
        Three steps, each with a job. Pick by what the surface <em>is</em>, not by how heavy it
        should look — that is the whole reason the steps are named <code>e1</code>/<code>e2</code>/
        <code>e3</code> rather than <code>sm</code>/<code>md</code>/<code>lg</code>.
      </p>

      {dark ? (
        <p className="text-body text-muted-foreground">
          <strong>Dark-mode rule:</strong> a shadow alone does not read on <code>#0f172a</code>, so
          every elevated surface in dark mode <em>also</em> carries{' '}
          <code>border border-border-subtle</code>. Dark elevation is a border-plus-shadow pair,
          never a shadow alone — the panels below show the exact markup #350 copies.
        </p>
      ) : null}

      <div className="flex flex-col gap-8">
        {STEPS.map(({ utility, job }) => (
          <div key={utility} className="flex flex-col gap-2">
            <p className="text-caption text-muted-foreground">
              <code>{utility}</code> — {job}
              {dark ? (
                <>
                  {' '}
                  + <code>border border-border-subtle</code>
                </>
              ) : null}
            </p>
            <div
              className={[
                'rounded-lg bg-card p-4',
                utility,
                dark ? 'border border-border-subtle' : '',
              ]
                .filter(Boolean)
                .join(' ')}
            >
              Total outstanding — ৳ 11,000 across 2 of 3 children.
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

/** The three steps in the default (light) theme, on the tinted ground. */
export const Scale: Story = {
  render: () => <ElevationScale />,
};

/**
 * The same three steps under `:root[data-theme="dark"]`, where the alphas
 * roughly triple and the tint drops to pure black — and where each panel
 * carries the mandatory 1px subtle border alongside its shadow.
 */
export const ScaleDark: Story = {
  // [8.13.12]: see `borders.stories.tsx`'s `RolesDark` for why this is
  // required alongside `darkDecorator`, not merely belt-and-braces.
  parameters: darkDecoratorParameters,
  decorators: [darkDecorator],
  render: () => <ElevationScale dark />,
};

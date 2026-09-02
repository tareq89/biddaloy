/**
 * Foundations story for [8.14.14]'s focus-ring migration. The canonical
 * class string lives on `ui/src/primitives/button.tsx`; the matching focus
 * section of `docs/architecture/09-design-direction.md` is owned by another
 * lane of the 8.14 run and is not in this branch. Like
 * `borders.stories.tsx`, this file demos a *decision*, not a component —
 * every control below already has its own story elsewhere; this file's
 * job is to show that they all now render the same focus indicator.
 *
 * Real `:focus-visible` is exclusive to one element per document, so a
 * pointer/keyboard `play()` could only ever light up a single cell of the
 * grid below at a time, not all of them together for a side-by-side
 * comparison. `AllControls` instead forces the look directly, the same
 * way `button.stories.tsx`'s state matrix does: apply the ring classes
 * unprefixed (`ring-2 ring-ring ring-offset-2 ring-offset-background`)
 * next to the component's own `focus-visible:` variant. `cn()`
 * (`tailwind-merge`) treats a bare `ring-2` and a `focus-visible:ring-2`
 * as different variant groups, so both are kept rather than one replacing
 * the other — the forced classes render pixel-identical to a real
 * `:focus-visible`, because that is genuinely the same ring, just applied
 * unconditionally instead of behind the pseudo-class.
 */
import type { Meta, StoryObj } from '@storybook/react-vite';
import type { ReactNode } from 'react';

import { darkDecorator, darkDecoratorParameters } from '../../.storybook/dark-decorator';
import { rtlDecorator } from '../../.storybook/rtl-decorator';
import { Button } from '../components/button';
import { Card } from '../components/card';
import { Checkbox } from '../primitives/checkbox';
import { Input } from '../primitives/input';
import { RadioGroup, RadioGroupItem } from '../primitives/radio-group';
import { Select, SelectTrigger, SelectValue } from '../primitives/select';
import { Tabs, TabsList, TabsTrigger } from '../primitives/tabs';
import { Textarea } from '../primitives/textarea';

/** The one-sentence rule, rendered in the story canvas rather than parked
 * in `parameters.docs.description.component`, for the same reason
 * `borders.stories.tsx` does it: this file deliberately does not carry
 * `tags: ['autodocs']` (see `meta` below), so an autodocs-only description
 * would be invisible. */
const FOCUS_RULE =
  'Every focusable control shows the same indicator: a 2px brand ring, held off the control by a 2px ground-coloured gutter. Rest and Focus are shown side by side; the Focus column is forced, not really focused.';

/** No `tags: ['autodocs']`, deliberately — same reason as
 * `borders.stories.tsx` and `elevation.stories.tsx`. The `*Dark` stories
 * below set `document.documentElement.dataset.theme` through
 * `darkDecorator`, so autodocs would render the light and dark variants on
 * one page and the last one mounted would win for both. */
const meta: Meta = {
  title: 'Foundations/Focus',
};

export default meta;
type Story = StoryObj;

/** The canonical string, copied verbatim from `button.tsx` — every row
 * below except the three documented deviations (SkipLink, DatePicker,
 * Tabs trigger) applies exactly this, unprefixed, to force the "Focus"
 * column. */
const FORCED_FOCUS = 'ring-2 ring-ring ring-offset-2 ring-offset-background';

/** Date-picker's day-cell deviation: `ring-offset-popover` (it renders
 * inside a `PopoverContent`) plus `relative z-10` (the grid's 4px gutter
 * is exactly the ring's width, so neighbouring cells' backgrounds would
 * otherwise paint over it). */
const FORCED_FOCUS_ON_POPOVER = 'relative z-10 ring-2 ring-ring ring-offset-2 ring-offset-popover';

/** SkipLink's deviation: no offset at all — it paints directly over page
 * content when revealed, so a ground-coloured gap would look like a
 * rendering glitch rather than a focus ring. */
const FORCED_FOCUS_NO_OFFSET = 'ring-2 ring-ring';

/** Tabs trigger's deviation: the canonical offset, plus `z-10`. Triggers are
 * `flex-1` siblings that are all `relative`, so without stacking the next
 * trigger's `data-[state=active]:bg-card` paints over the focused trigger's
 * ring. The real component applies this behind `focus-visible:`; forcing it
 * here keeps the story showing exactly what ships. */
const FORCED_FOCUS_STACKED = `relative z-10 ${FORCED_FOCUS}`;

function FocusLabel({ children }: { children: string }) {
  return <p className="text-caption text-muted-foreground">{children}</p>;
}

function ControlRow({ name, rest, focus }: { name: string; rest: ReactNode; focus: ReactNode }) {
  return (
    <tr>
      <td className="pe-4 text-sm text-muted-foreground">{name}</td>
      <td className="p-2">{rest}</td>
      <td className="p-2">{focus}</td>
    </tr>
  );
}

/**
 * Every migrated control, rest state next to forced-focus state. One row
 * per control this ticket touched, in the order the plan lists them.
 *
 * The DatePicker row does not render the real `DatePicker`/`Calendar`
 * components: their day-cell button has no `className` prop of its own to
 * force a single cell's focus state onto (it is an implementation detail
 * of `Calendar`, not part of its public API), and forcing real
 * `:focus-visible` would light up the browser's actual focused element,
 * not a chosen cell. The cell below is a literal copy of
 * `date-picker.tsx`'s day-cell class string, inside a small
 * `PopoverContent`-styled wrapper so the `ring-offset-popover` deviation
 * reads correctly against its real surface colour.
 *
 * The SkipLink row has the same problem for a different reason: the real
 * `SkipLink` component takes no `className` prop (it is deliberately
 * `sr-only` until focus, which is the whole point of the pattern), so
 * there is nothing to pass forced classes into. The cell below copies its
 * exact class string with `sr-only` replaced by `not-sr-only` so it is
 * visible in this static grid, and the deliberate no-offset ring applied
 * unprefixed.
 */
function AllControlsGrid() {
  return (
    <div className="space-y-4">
      <p className="max-w-prose text-body text-muted-foreground">{FOCUS_RULE}</p>
      <table className="border-separate border-spacing-2">
        <thead>
          <tr>
            <th className="text-start text-sm font-medium text-muted-foreground">Control</th>
            <th className="text-start text-sm font-medium text-muted-foreground">Rest</th>
            <th className="text-start text-sm font-medium text-muted-foreground">Focus</th>
          </tr>
        </thead>
        <tbody>
          <ControlRow
            name="Input"
            rest={<Input aria-label="Guardian phone" placeholder="Guardian phone" />}
            focus={
              <Input
                aria-label="Guardian phone"
                placeholder="Guardian phone"
                className={FORCED_FOCUS}
              />
            }
          />
          <ControlRow
            name="Textarea"
            rest={<Textarea aria-label="Note" placeholder="Note" />}
            focus={<Textarea aria-label="Note" placeholder="Note" className={FORCED_FOCUS} />}
          />
          <ControlRow
            name="Checkbox"
            rest={<Checkbox aria-label="Send SMS receipt" />}
            focus={<Checkbox aria-label="Send SMS receipt" className={FORCED_FOCUS} />}
          />
          <ControlRow
            name="RadioGroup item"
            rest={
              <RadioGroup defaultValue="cash" aria-label="Payment method">
                <RadioGroupItem value="cash" aria-label="Cash" />
              </RadioGroup>
            }
            focus={
              <RadioGroup defaultValue="cash" aria-label="Payment method">
                <RadioGroupItem value="cash" aria-label="Cash" className={FORCED_FOCUS} />
              </RadioGroup>
            }
          />
          <ControlRow
            name="Tabs trigger"
            rest={
              <Tabs defaultValue="fees">
                <TabsList>
                  <TabsTrigger value="fees">Fees</TabsTrigger>
                </TabsList>
              </Tabs>
            }
            focus={
              /* Two triggers, with the *first* focused and the second active:
               this row exists to show the stacking deviation, and a single
               trigger cannot show it. The active sibling's `bg-card` is
               exactly what would paint over the ring without `z-10`. */
              <Tabs defaultValue="results">
                <TabsList>
                  <TabsTrigger value="fees" className={FORCED_FOCUS_STACKED}>
                    Fees
                  </TabsTrigger>
                  <TabsTrigger value="results">Results</TabsTrigger>
                </TabsList>
              </Tabs>
            }
          />
          <ControlRow
            name="Select trigger"
            rest={
              <Select defaultValue="dhaka">
                <SelectTrigger aria-label="Region">
                  <SelectValue placeholder="Region" />
                </SelectTrigger>
              </Select>
            }
            focus={
              <Select defaultValue="dhaka">
                <SelectTrigger aria-label="Region" className={FORCED_FOCUS}>
                  <SelectValue placeholder="Region" />
                </SelectTrigger>
              </Select>
            }
          />
          <ControlRow
            name="Button"
            rest={<Button>Save</Button>}
            focus={<Button className={FORCED_FOCUS}>Save</Button>}
          />
          <ControlRow
            name="DatePicker day cell"
            rest={
              <div className="w-fit rounded-lg bg-popover p-2.5 ring-1 ring-foreground/10 dark:ring-border-subtle">
                <button
                  type="button"
                  className="rounded-md p-1.5 text-sm outline-none hover:bg-muted"
                >
                  14
                </button>
              </div>
            }
            focus={
              <div className="w-fit rounded-lg bg-popover p-2.5 ring-1 ring-foreground/10 dark:ring-border-subtle">
                <button
                  type="button"
                  className={`rounded-md p-1.5 text-sm outline-none hover:bg-muted ${FORCED_FOCUS_ON_POPOVER}`}
                >
                  14
                </button>
              </div>
            }
          />
          <ControlRow
            name="SkipLink"
            rest={<FocusLabel>sr-only until focus — nothing to show at rest</FocusLabel>}
            focus={
              <a
                href="#main-content"
                className={`not-sr-only rounded-md bg-card px-4 py-2 text-sm font-medium text-foreground shadow-e3 outline-none ${FORCED_FOCUS_NO_OFFSET}`}
              >
                Skip to content
              </a>
            }
          />
        </tbody>
      </table>
    </div>
  );
}

export const AllControls: Story = {
  render: () => <AllControlsGrid />,
};

export const AllControlsDark: Story = {
  render: () => <AllControlsGrid />,
  decorators: [darkDecorator],
  parameters: darkDecoratorParameters,
};

export const AllControlsRtl: Story = {
  render: () => <AllControlsGrid />,
  decorators: [rtlDecorator],
};

/**
 * The offset-colour-vs-surface question in one screenshot: the same
 * `Button`, forced focused, on four different ground colours — page,
 * `Card`, a `DialogContent`-styled surface, a `PopoverContent`-styled
 * surface. All four use `ring-offset-background` (the accepted trade-off
 * recorded in the design contract): the light-mode delta between page
 * ground (`#f8fafc`) and card/dialog/popover surface (`#ffffff`) is
 * imperceptible, and the dark-mode delta (page `neutral-900` vs surface
 * `#1e293b`) reads as an intentional 2px separator rather than a bug.
 *
 * These are hand-styled boxes carrying the same tokens as
 * `Card`/`DialogContent`/`PopoverContent` (`bg-card`/`bg-popover`,
 * `ring-1 ring-foreground/10`, `shadow-e*`), not the live Radix
 * primitives — `DialogContent`/`PopoverContent` only render through a
 * portal while open, which this static story does not drive.
 */
function OnSurfaces() {
  return (
    <div className="flex flex-wrap gap-4">
      <div className="flex flex-col gap-2">
        <FocusLabel>Page ground</FocusLabel>
        <div className="rounded-lg bg-background p-4">
          <Button className={FORCED_FOCUS}>Save</Button>
        </div>
      </div>
      <div className="flex flex-col gap-2">
        <FocusLabel>Card</FocusLabel>
        <Card className="p-4">
          <Button className={FORCED_FOCUS}>Save</Button>
        </Card>
      </div>
      <div className="flex flex-col gap-2">
        <FocusLabel>DialogContent surface</FocusLabel>
        <div className="rounded-xl bg-popover p-4 shadow-e3 ring-1 ring-foreground/10 dark:ring-border-subtle">
          <Button className={FORCED_FOCUS}>Save</Button>
        </div>
      </div>
      <div className="flex flex-col gap-2">
        <FocusLabel>PopoverContent surface</FocusLabel>
        <div className="rounded-lg bg-popover p-2.5 shadow-e2 ring-1 ring-foreground/10 dark:ring-border-subtle">
          <Button className={FORCED_FOCUS}>Save</Button>
        </div>
      </div>
    </div>
  );
}

export const OnSurfacesStory: Story = {
  name: 'OnSurfaces',
  render: () => <OnSurfaces />,
};

export const OnSurfacesDark: Story = {
  name: 'OnSurfaces (dark)',
  render: () => <OnSurfaces />,
  decorators: [darkDecorator],
  parameters: darkDecoratorParameters,
};

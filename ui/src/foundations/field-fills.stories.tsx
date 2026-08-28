/**
 * Foundations story for one rule that only shows up when three primitives are
 * rendered together: **on the `#f8fafc` ground, every text-entry control has
 * the same fill.**
 *
 * [8.13.9] moved the ground from white to `#f8fafc` and moved `Input` from
 * `bg-transparent` to `bg-card`, so a field reads as fillable white on a grey
 * page. `Select` and `Textarea` were left behind on `bg-transparent` and
 * therefore rendered *grey* — a review caught it, and this story is the thing
 * that would have caught it earlier. Each primitive's own story file shows it
 * in isolation, where a transparent fill is invisible; the mismatch is only
 * legible in one form row.
 *
 * Both themes and both enabled/disabled states are here, because that is the
 * full matrix the three primitives have to agree across: `bg-card` resting,
 * `bg-input/50` disabled, `bg-input/30` dark resting, `bg-input/80` dark
 * disabled.
 */
import type { Meta, StoryObj } from '@storybook/react-vite';

import { darkDecorator } from '../../.storybook/dark-decorator';
import { Input } from '../components/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../components/select';
import { Textarea } from '../components/textarea';

const meta: Meta = {
  title: 'Foundations/Field fills',
};

export default meta;
type Story = StoryObj;

function Row({ disabled = false }: { disabled?: boolean }) {
  return (
    <div className="flex flex-col gap-2 sm:flex-row sm:items-start">
      <Input
        aria-label={disabled ? 'Student name (disabled)' : 'Student name'}
        defaultValue="Karim Ahmed"
        disabled={disabled}
      />
      <Select defaultValue="six" disabled={disabled}>
        <SelectTrigger aria-label={disabled ? 'Class (disabled)' : 'Class'}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="six">Six</SelectItem>
          <SelectItem value="seven">Seven</SelectItem>
        </SelectContent>
      </Select>
      <Textarea
        aria-label={disabled ? 'Note (disabled)' : 'Note'}
        defaultValue="Transferred in mid-term."
        disabled={disabled}
      />
    </div>
  );
}

function FieldFills() {
  return (
    <div className="flex flex-col gap-6 bg-background p-6">
      <p className="text-body text-muted-foreground">
        On the grey ground, <code>Input</code>, <code>Select</code> and <code>Textarea</code> all
        fill <code>bg-card</code>. If one of them looks grey here, it has slipped back to{' '}
        <code>bg-transparent</code>.
      </p>

      <div className="flex flex-col gap-2">
        <p className="text-caption text-muted-foreground">Enabled — all three read as white.</p>
        <Row />
      </div>

      <div className="flex flex-col gap-2">
        <p className="text-caption text-muted-foreground">
          Disabled — all three dim to <code>bg-input/50</code>, still matching each other.
        </p>
        <Row disabled />
      </div>
    </div>
  );
}

/** The three field primitives side by side in the default (light) theme. */
export const Fills: Story = {
  render: () => <FieldFills />,
};

/**
 * The same matrix under `:root[data-theme="dark"]`, where the resting fill is
 * `bg-input/30` and the disabled fill is `bg-input/80`.
 */
export const FillsDark: Story = {
  decorators: [darkDecorator],
  render: () => <FieldFills />,
};

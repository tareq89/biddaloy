import type { Meta, StoryObj } from '@storybook/react-vite';

import { darkDecorator, darkDecoratorParameters } from '../../.storybook/dark-decorator';

import { Skeleton, SkeletonFieldList, SkeletonTable, SkeletonText } from './skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from './table';

const meta: Meta<typeof Skeleton> = {
  title: 'Components/Skeleton',
  component: Skeleton,
  tags: ['autodocs'],
};

export default meta;
type Story = StoryObj<typeof Skeleton>;

export const Default: Story = {
  args: { className: 'h-4 w-48' },
};

export const RowOfFields: Story = {
  render: () => (
    <div className="flex flex-col gap-2">
      <Skeleton className="h-4 w-32" />
      <Skeleton className="h-8 w-full" />
    </div>
  ),
};

/** Stacked lines, last one short. The shape the six route-level
 * query-state helpers used to hand-roll three `Skeleton`s for. */
export const Text: StoryObj<typeof SkeletonText> = {
  render: () => <SkeletonText lines={3} />,
};

/** Built from the real `Table` parts, so a row here is the same height as
 * the row that replaces it. */
export const TableShape: StoryObj<typeof SkeletonTable> = {
  render: () => <SkeletonTable rows={4} columns={5} />,
};

/** The label-over-value grid every detail "overview" tab renders. */
export const FieldList: StoryObj<typeof SkeletonFieldList> = {
  render: () => <SkeletonFieldList fields={4} />,
};

/**
 * The claim `SkeletonTable` exists to make, side by side: the placeholder
 * on top and the real table underneath occupy the same box, so nothing
 * below them moves when the data lands. If a future change to `table.tsx`
 * breaks that, this story is where it shows up as a visible step in the
 * seam between the two.
 */
export const LayoutStability: StoryObj<typeof SkeletonTable> = {
  render: () => (
    <div className="flex flex-col gap-6">
      <SkeletonTable rows={2} columns={3} />
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Date</TableHead>
            <TableHead>Amount</TableHead>
            <TableHead>Method</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          <TableRow>
            <TableCell>2026-03-01</TableCell>
            <TableCell>৳ 2,400</TableCell>
            <TableCell>bKash</TableCell>
          </TableRow>
          <TableRow>
            <TableCell>2026-02-01</TableCell>
            <TableCell>৳ 2,400</TableCell>
            <TableCell>Cash</TableCell>
          </TableRow>
        </TableBody>
      </Table>
    </div>
  ),
};

function renderShapeMatrix() {
  return (
    <div className="flex flex-col gap-8">
      <section className="flex flex-col gap-2">
        <p className="text-sm font-medium text-muted-foreground">SkeletonText</p>
        <SkeletonText lines={3} />
      </section>
      <section className="flex flex-col gap-2">
        <p className="text-sm font-medium text-muted-foreground">SkeletonTable</p>
        <SkeletonTable rows={3} columns={4} />
      </section>
      <section className="flex flex-col gap-2">
        <p className="text-sm font-medium text-muted-foreground">SkeletonFieldList</p>
        <SkeletonFieldList fields={4} />
      </section>
      <section className="flex flex-col gap-2">
        <p className="text-sm font-medium text-muted-foreground">Skeleton (bare)</p>
        <Skeleton className="h-24 w-full rounded-lg" />
      </section>
    </div>
  );
}

/** Every shape this module ships, in one frame — [8.13.11]'s state
 * matrix for the loading half of the empty/loading/error family. */
export const Shapes: StoryObj<typeof Skeleton> = {
  tags: ['!autodocs'],
  render: renderShapeMatrix,
};

/** Same matrix on the dark half of the token pair. `bg-muted` is
 * re-pointed to the elevated surface in dark mode, so this is the only
 * place the shimmer's dark value is visible. Its own story, and excluded
 * from autodocs, because `darkDecorator` mutates `<html>` — see the
 * decorator's own doc comment. */
export const ShapesDark: StoryObj<typeof Skeleton> = {
  tags: ['!autodocs'],
  decorators: [darkDecorator],
  parameters: darkDecoratorParameters,
  render: renderShapeMatrix,
};

/**
 * What a user with "reduce motion" on sees. Storybook cannot fake the OS
 * setting, so this story pins the animation off directly — the same
 * `animate-none` the `motion-reduce:` variant applies — to show that a
 * static placeholder is still legible as a placeholder rather than as a
 * broken grey block.
 */
export const ReducedMotion: Story = {
  render: () => (
    <div className="flex flex-col gap-2">
      <Skeleton className="h-6 w-full animate-none" />
      <Skeleton className="h-6 w-full animate-none" />
      <Skeleton className="h-6 w-2/3 animate-none" />
    </div>
  ),
};

import type { Meta, StoryObj } from '@storybook/react';
import { useState } from 'react';

import { rtlDecorator } from '../../.storybook/rtl-decorator';

import { GlobalSearch, type GlobalSearchGroup } from './global-search';

const meta: Meta<typeof GlobalSearch> = {
  title: 'Components/GlobalSearch',
  component: GlobalSearch,
  tags: ['autodocs'],
};

export default meta;
type Story = StoryObj<typeof GlobalSearch>;

const POPULATED_GROUPS: GlobalSearchGroup[] = [
  {
    id: 'students',
    label: 'Students',
    results: [
      { id: 's1', label: 'Ahmed Khan', description: 'Roll 7 · Class Six' },
      { id: 's2', label: 'Fatima Begum', description: 'Roll 8 · Class Six' },
    ],
  },
  {
    id: 'guardians',
    label: 'Guardians',
    results: [{ id: 'g1', label: 'Karim Khan', description: 'Father of Ahmed Khan' }],
  },
  {
    id: 'invoices',
    label: 'Invoices',
    results: [{ id: 'i1', label: 'INV-2026-00042', description: '৳4,500 · Ahmed Khan' }],
  },
];

function Demo({
  groups = [],
  initialQuery = '',
}: {
  groups?: GlobalSearchGroup[];
  initialQuery?: string;
}) {
  const [open, setOpen] = useState(true);
  const [query, setQuery] = useState(initialQuery);
  return (
    <GlobalSearch
      aria-label="Search everything"
      open={open}
      onOpenChange={setOpen}
      query={query}
      onQueryChange={setQuery}
      groups={query.trim() === '' ? [] : groups}
      onSelect={() => {}}
    />
  );
}

/** Nothing typed yet — explains what's searchable rather than a blank
 * panel or a dead-end placeholder. */
export const Default: Story = {
  render: () => <Demo />,
};

export const Populated: Story = {
  render: () => <Demo groups={POPULATED_GROUPS} initialQuery="ah" />,
};

/** A query that matched nothing — distinct copy from the pre-search
 * empty state above, per [8.9.9]'s own acceptance criterion. */
export const NoResults: Story = {
  render: () => <Demo groups={[]} initialQuery="zzz" />,
};

/** No dedicated "Loading" story: each group's `isLoading` renders a
 * skeleton row, exercised directly in `global-search.test.tsx` rather
 * than duplicated here, since it depends on partial-group timing a
 * static story can't represent well. */

export const RightToLeft: Story = {
  render: () => (
    <Demo
      groups={[
        {
          id: 'students',
          label: 'শিক্ষার্থী',
          results: [{ id: 's1', label: 'আহমেদ খান', description: 'রোল ৭' }],
        },
      ]}
      initialQuery="আহমেদ"
    />
  ),
  decorators: [rtlDecorator],
};

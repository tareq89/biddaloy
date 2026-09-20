import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState } from 'react';

import { rtlDecorator } from '../../.storybook/rtl-decorator';

import { CommandPalette, type CommandPaletteTab } from './command-palette';

const meta: Meta<typeof CommandPalette> = {
  title: 'Components/CommandPalette',
  component: CommandPalette,
  tags: ['autodocs'],
};

export default meta;
type Story = StoryObj<typeof CommandPalette>;

const PEOPLE_TAB: CommandPaletteTab = {
  id: 'people',
  label: 'People',
  groups: [
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
  ],
};

const PAGE_TAB: CommandPaletteTab = {
  id: 'page',
  label: 'Page',
  groups: [
    {
      id: 'pages',
      label: 'Pages',
      results: [
        { id: 'p1', label: 'Fee dues', description: 'Finance › Fee dues' },
        { id: 'p2', label: 'Timetable & routines', description: 'Academics › Routine' },
      ],
    },
  ],
};

const ACTION_TAB: CommandPaletteTab = {
  id: 'action',
  label: 'Action',
  groups: [
    {
      id: 'actions',
      label: 'Actions',
      results: [{ id: 'a1', label: 'Record payment', description: 'Opens the payment form' }],
    },
  ],
};

function Demo({
  tabs = [PEOPLE_TAB, PAGE_TAB, ACTION_TAB],
  initialQuery = '',
}: {
  tabs?: [CommandPaletteTab, CommandPaletteTab, CommandPaletteTab];
  initialQuery?: string;
}) {
  const [open, setOpen] = useState(true);
  const [query, setQuery] = useState(initialQuery);
  return (
    <CommandPalette
      aria-label="Command palette"
      open={open}
      onOpenChange={setOpen}
      query={query}
      onQueryChange={setQuery}
      tabs={tabs}
      onSelect={() => {}}
    />
  );
}

/** Opens on People with an empty query — shows the searchable hint since
 * this story has no persisted recents (localStorage is empty per story
 * mount). */
export const Default: Story = {
  render: () => <Demo />,
};

export const PeoplePopulated: Story = {
  render: () => <Demo initialQuery="ah" />,
};

export const PageTab: Story = {
  render: () => {
    const [open, setOpen] = useState(true);
    const [query, setQuery] = useState('routine');
    return (
      <CommandPalette
        aria-label="Command palette"
        open={open}
        onOpenChange={setOpen}
        query={query}
        onQueryChange={setQuery}
        tabs={[PEOPLE_TAB, PAGE_TAB, ACTION_TAB]}
        onSelect={() => {}}
        initialTab="page"
      />
    );
  },
};

/** A query that matched nothing — distinct copy from the pre-search
 * empty state, same reasoning as `GlobalSearch`'s own `NoResults` story. */
export const NoResults: Story = {
  render: () => (
    <Demo
      tabs={[
        { ...PEOPLE_TAB, groups: [] },
        { ...PAGE_TAB, groups: [] },
        { ...ACTION_TAB, groups: [] },
      ]}
      initialQuery="zzz"
    />
  ),
};

export const RightToLeft: Story = {
  render: () => (
    <Demo
      tabs={[
        {
          id: 'people',
          label: 'ব্যক্তি',
          groups: [
            {
              id: 'students',
              label: 'শিক্ষার্থী',
              results: [{ id: 's1', label: 'আহমেদ খান', description: 'রোল ৭' }],
            },
          ],
        },
        { ...PAGE_TAB, label: 'পাতা' },
        { ...ACTION_TAB, label: 'কার্য' },
      ]}
      initialQuery="আহমেদ"
    />
  ),
  decorators: [rtlDecorator],
};

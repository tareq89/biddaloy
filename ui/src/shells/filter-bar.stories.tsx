/**
 * [8.14.8]'s typed search form. Every story renders a full, working
 * `FilterBar` — local `useState` standing in for `ListShellState.filters`/
 * `ListShellActions.setFilters` (this component takes plain `values` +
 * `onChange`, the same router-agnostic contract every shell in this
 * directory uses), so clicking around in Storybook exercises the real
 * debounce/normalization/chip logic, not a frozen mock.
 *
 * No loading/error/disabled state applies here — `FilterBar` is pure
 * client-side form state (no fetch of its own); the states worth a story
 * are the ones below (empty, active-filter chips, an unknown deep-linked
 * filter, mobile collapse, RTL).
 */
import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState } from 'react';

import { rtlDecorator } from '../../.storybook/rtl-decorator';

import type { FilterFieldDescriptor } from './filter-bar';
import { FilterBar } from './filter-bar';

const meta: Meta<typeof FilterBar> = {
  title: 'Shells/FilterBar',
  tags: ['autodocs'],
};

export default meta;
type Story = StoryObj<typeof FilterBar>;

// One of each of the five descriptor kinds — the same set
// `filter-bar.test.tsx` exercises, kept here so a change to one is easy to
// eyeball in both places at once.
const FIELDS: FilterFieldDescriptor[] = [
  {
    kind: 'text',
    key: 'search',
    label: 'Search',
    placeholder: 'Search by name or roll number…',
    primary: true,
  },
  {
    kind: 'select',
    key: 'status',
    label: 'Status',
    allLabel: 'All statuses',
    options: [
      { value: 'active', label: 'Active' },
      { value: 'inactive', label: 'Inactive' },
    ],
  },
  {
    kind: 'date-range',
    fromKey: 'from_date',
    toKey: 'to_date',
    label: 'Date range',
    fromLabel: 'From date',
    toLabel: 'To date',
  },
  { kind: 'checkbox', key: 'flagged', label: 'Overdue only' },
  {
    kind: 'number-range',
    minKey: 'min_amount',
    maxKey: 'max_amount',
    label: 'Amount',
    minLabel: 'Min amount',
    maxLabel: 'Max amount',
  },
];

function FilterBarDemo({ initialValues = {} }: { initialValues?: Record<string, string> }) {
  const [values, setValues] = useState<Record<string, string>>(initialValues);
  return (
    <FilterBar
      fields={FIELDS}
      values={values}
      onChange={(patch) =>
        setValues((current) => {
          const next = { ...current };
          for (const [key, value] of Object.entries(patch)) {
            if (value === null) delete next[key];
            else next[key] = value;
          }
          return next;
        })
      }
    />
  );
}

/** Desktop, no active filters — every control visible inline (the mobile
 * disclosure only collapses below the `md` breakpoint), no chip row. */
export const Default: Story = {
  render: () => <FilterBarDemo />,
};

/** Three active filters — chips render under the controls, each with its
 * own remove button, plus "Clear all" once more than one is active. */
export const WithActiveFilters: Story = {
  render: () => (
    <FilterBarDemo initialValues={{ status: 'active', flagged: 'true', from_date: '2024-01-01' }} />
  ),
};

/** `values` carries `student_id`, a key **no descriptor in `FIELDS`
 * declares** — the exact shape of the bug this ticket exists to kill
 * (`invoices/index.tsx` accepted `student_id` in its URL schema but
 * rendered no control, and no chip, for it). The chip below still renders
 * — generic `key: value` text — and its remove button still clears it.
 * This story is the visual regression guard for that bug class. */
export const DeepLinkedUnknownFilter: Story = {
  render: () => <FilterBarDemo initialValues={{ status: 'active', student_id: 'stu-042' }} />,
};

/** Narrowed below `md`: the primary search field stays inline, every
 * other control collapses behind the "Filters (n)" trigger — same
 * `aria-expanded`/`aria-controls` grammar `app-shell.tsx`'s nav-group
 * disclosure already uses. Two filters active, so the trigger reads
 * "Filters (2)". */
export const Mobile: Story = {
  render: () => <FilterBarDemo initialValues={{ status: 'active', flagged: 'true' }} />,
  parameters: { viewport: { defaultViewport: 'mobile1' } },
};

/** Same viewport as `Mobile`, panel expanded — click the trigger below or
 * open this story directly to see every control the collapsed state was
 * hiding, with the table (in a real page) still above the fold. */
export const MobileExpanded: Story = {
  render: () => <FilterBarDemo initialValues={{ status: 'active', flagged: 'true' }} />,
  parameters: { viewport: { defaultViewport: 'mobile1' } },
  play: async ({ canvasElement }) => {
    const { within, userEvent } = await import('storybook/test');
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole('button', { name: /Filters/ }));
  },
};

/** `globals: { locale: 'bn' }` switches translated copy to Bangla; typing
 * Bengali digits into the search and amount fields still commits ASCII —
 * `use-filter-bar-state.ts`'s normalization runs regardless of the active
 * locale, since the OS keyboard (not the app locale) decides what a user
 * types. */
export const Bangla: Story = {
  render: () => <FilterBarDemo initialValues={{ search: '০১২', min_amount: '৫০০' }} />,
  globals: { locale: 'bn' },
};

/** Bidi flip — neither of this package's two locales is actually RTL, but
 * every component here still needs one RTL story proving the layout
 * (chip row, disclosure trigger, icon-only remove buttons) holds up under
 * a flip, same reasoning `button.stories.tsx`'s own `RTL` story documents. */
export const RTL: Story = {
  render: () => <FilterBarDemo initialValues={{ status: 'active' }} />,
  decorators: [rtlDecorator],
};

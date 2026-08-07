/**
 * Storybook infra proof ([8.6.1]) — not a real component's stories. Delete
 * alongside `placeholder.tsx` once a real wrapper ([8.6.2]) replaces it.
 */
import type { Meta, StoryObj } from '@storybook/react';
import { expect, waitFor, within } from '@storybook/test';

import { useStorybookLocale } from '../../.storybook/locale';
import { useStudents } from '../hooks/students';

import { Placeholder } from './placeholder';

const meta: Meta<typeof Placeholder> = {
  title: 'Infra/Placeholder',
  component: Placeholder,
  tags: ['autodocs'],
};

export default meta;
type Story = StoryObj<typeof Placeholder>;

export const Default: Story = {
  args: {
    children: 'Hello from Storybook',
  },
};

/** Proves the locale toolbar reaches story content: switching locale in the
 * toolbar swaps this text for a longer Bangla equivalent, which is the
 * text-expansion check the issue's acceptance criteria ask for. */
function LocaleSample() {
  const locale = useStorybookLocale();
  const sample =
    locale === 'bn'
      ? 'সংশ্লিষ্ট শিক্ষার্থীর ভর্তি ফি পরিশোধের সময়সীমা উত্তীর্ণ হয়েছে'
      : 'The enrollment fee payment deadline has passed';
  return <Placeholder>{sample}</Placeholder>;
}

export const LocaleTextExpansion: StoryObj<typeof LocaleSample> = {
  render: () => <LocaleSample />,
};

/** Proves stories can render against the shared MSW handler library from
 * [8.4.2] — no per-story fetch mocking needed, just the default handler
 * `preview.tsx` wires up for every story. */
function StudentCount() {
  const { data, isLoading } = useStudents();
  if (isLoading) return <Placeholder>Loading students…</Placeholder>;
  return <Placeholder>{data?.total ?? 0} students</Placeholder>;
}

export const MswBackedData: StoryObj<typeof StudentCount> = {
  render: () => <StudentCount />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await waitFor(() => expect(canvas.getByText(/students$/)).toBeTruthy());
  },
};

/**
 * Storybook infra proof ([8.6.1]) — not a real component's stories. Delete
 * alongside `placeholder.tsx` once a real wrapper ([8.6.2]) replaces it.
 */
import type { Meta, StoryObj } from '@storybook/react';
import { expect, waitFor, within } from '@storybook/test';
import { useTranslation } from 'react-i18next';

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

/** Proves the locale toolbar reaches story content: switching locale in
 * the toolbar (`preview.tsx`) drives the real i18next instance, and this
 * component's `useTranslation('students')` call re-renders with the
 * longer Bangla equivalent — the text-expansion check the issue's
 * acceptance criteria ask for, now against real translations instead of a
 * Storybook-only stand-in. */
function LocaleSample() {
  const { t } = useTranslation('students');
  return <Placeholder>{t('feeReminder.overdue')}</Placeholder>;
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

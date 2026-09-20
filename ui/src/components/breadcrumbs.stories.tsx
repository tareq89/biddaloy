/**
 * No loading/error variants of its own — `Breadcrumbs` renders a fixed
 * array of already-resolved crumbs and holds no data. The `Loading` story
 * below shows the *caller's* loading state: a crumb whose label is still
 * an unresolved id, before whatever wires this component up fetches the
 * real name.
 */
import type { Meta, StoryObj } from '@storybook/react-vite';

import { withMemoryRouter } from '../../.storybook/router-decorator';
import { rtlDecorator } from '../../.storybook/rtl-decorator';

import { Breadcrumbs } from './breadcrumbs';

const meta: Meta<typeof Breadcrumbs> = {
  title: 'Components/Breadcrumbs',
  component: Breadcrumbs,
  tags: ['autodocs'],
  args: { 'aria-label': 'Breadcrumb' },
  decorators: [withMemoryRouter(['/'])],
};

export default meta;
type Story = StoryObj<typeof Breadcrumbs>;

export const ThreeLevelTrail: Story = {
  args: {
    items: [
      { label: 'Students', to: '/students' },
      { label: 'Sections', to: '/students/sections' },
      { label: 'Class 8A' },
    ],
  },
};

export const TwoLevelTrail: Story = {
  args: {
    items: [
      { label: 'Students', to: '/students' },
      { label: 'Class 8A' },
    ],
  },
};

export const SingleCrumb: Story = {
  args: { items: [{ label: 'Students' }] },
};

/** The caller's loading state, not this component's own — the id stands
 * in for a name that hasn't resolved yet. `Breadcrumbs` itself never
 * fetches or resolves labels. */
export const Loading: Story = {
  args: {
    items: [
      { label: 'Students', to: '/students' },
      { label: 'STU-00231' },
    ],
  },
};

/** `viewport` narrows the canvas to phone width — below `md` only the
 * last two crumbs of a longer trail render, via pure CSS. */
export const LongTrailAtPhoneWidth: Story = {
  args: {
    items: [
      { label: 'Students', to: '/students' },
      { label: 'Sections', to: '/students/sections' },
      { label: 'Class 8A', to: '/students/sections/8a' },
      { label: 'Attendance', to: '/students/sections/8a/attendance' },
      { label: '2026-03-12' },
    ],
  },
  parameters: { viewport: { defaultViewport: 'mobile1' } },
};

export const RightToLeft: Story = {
  args: {
    items: [
      { label: 'শিক্ষার্থী', to: '/students' },
      { label: 'অষ্টম শ্রেণি' },
    ],
  },
  decorators: [rtlDecorator],
};

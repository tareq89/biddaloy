import type { Meta, StoryObj } from '@storybook/react-vite';

import { withMemoryRouter } from '../../.storybook/router-decorator';

import { DocumentCard } from './document-card';

const meta: Meta<typeof DocumentCard> = {
  title: 'Components/DocumentCard',
  component: DocumentCard,
  tags: ['autodocs'],
  decorators: [withMemoryRouter(['/'])],
  args: { title: 'Admit card', description: 'One card per student.', action: { label: 'Print' } },
};
export default meta;
type Story = StoryObj<typeof DocumentCard>;

export const Primary: Story = {
  args: { action: { label: 'Print admit cards', primary: true }, meta: '32 of 40 printed' },
};
export const Outline: Story = { args: { title: 'Seat list' } };
export const Unavailable: Story = {
  args: {
    title: 'Seat list',
    unavailable: {
      reason: 'No seat plan yet',
      fixLabel: 'Make a seat plan',
      fixHref: '/exams/seat-plan',
    },
  },
};

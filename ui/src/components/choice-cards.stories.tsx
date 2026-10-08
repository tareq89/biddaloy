import type { Meta, StoryObj } from '@storybook/react-vite';
import { Copy, FileText, Plus } from 'lucide-react';
import * as React from 'react';

import { ChoiceCards } from './choice-cards';

const meta: Meta<typeof ChoiceCards> = {
  title: 'Components/ChoiceCards',
  tags: ['autodocs'],
};

export default meta;
type Story = StoryObj<typeof ChoiceCards>;

const options = [
  { value: 'scratch', title: 'Start from scratch', description: 'A blank plan', icon: Plus },
  { value: 'template', title: 'Use a template', description: 'Pick a ready plan', icon: FileText },
  { value: 'copy', title: 'Copy last year', description: 'Reuse and adjust', icon: Copy },
];

function Controlled({ withIcons = true }: { withIcons?: boolean }) {
  const [value, setValue] = React.useState('scratch');
  return (
    <ChoiceCards
      value={value}
      onValueChange={setValue}
      label="How do you want to start?"
      options={
        withIcons
          ? options
          : options.map(({ value, title, description }) => ({ value, title, description }))
      }
    />
  );
}

export const Default: Story = { render: () => <Controlled /> };
export const WithoutIcons: Story = { render: () => <Controlled withIcons={false} /> };
export const Phone390: Story = {
  render: () => <Controlled />,
  parameters: { viewport: { defaultViewport: 'mobile1' } },
};

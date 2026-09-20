import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState } from 'react';

import { ShortcutsSheet } from './shortcuts-sheet';

const meta: Meta<typeof ShortcutsSheet> = {
  title: 'Components/ShortcutsSheet',
  component: ShortcutsSheet,
  tags: ['autodocs'],
};

export default meta;
type Story = StoryObj<typeof ShortcutsSheet>;

function Demo() {
  const [open, setOpen] = useState(true);
  return <ShortcutsSheet open={open} onOpenChange={setOpen} />;
}

export const Default: Story = {
  render: () => <Demo />,
};

import type { Meta, StoryObj } from '@storybook/react-vite';

import { DocumentsSection } from './DocumentsSection';

/** [48.3.C-02] Settings › Printing › Documents. Same unglobbed-client-admin note as `PrintersSection.stories.tsx`. */
const meta: Meta<typeof DocumentsSection> = {
  title: 'Settings/Documents',
  component: DocumentsSection,
  args: { schoolId: 'school-1' },
};
export default meta;

type Story = StoryObj<typeof DocumentsSection>;

export const Empty: Story = { args: { documents: undefined } };
export const Populated: Story = {
  args: { documents: { withholdAdmitCardForDues: true, serialPrefix: 'DAHS' } },
};

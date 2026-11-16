import { LegalDocument } from '@biddaloy/shared';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { fn } from 'storybook/test';

import { LegalDocumentsDialog } from './legal-documents-dialog';

/** [59.2.06] Terms, Privacy and Data agreement in one dialog, with the bn/en switch. */
const meta: Meta<typeof LegalDocumentsDialog> = {
  title: 'Features/Legal/LegalDocumentsDialog',
  component: LegalDocumentsDialog,
  args: {
    open: true,
    onOpenChange: fn(),
    onAgree: fn(),
    docs: [LegalDocument.TERMS, LegalDocument.PRIVACY, LegalDocument.DPA],
  },
};
export default meta;
type Story = StoryObj<typeof LegalDocumentsDialog>;

export const English: Story = { globals: { locale: 'en' } };

export const Bangla: Story = { globals: { locale: 'bn' } };

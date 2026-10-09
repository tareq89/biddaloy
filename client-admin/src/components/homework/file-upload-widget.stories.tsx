import type { Meta, StoryObj } from '@storybook/react-vite';

import { FileUploadWidget } from './file-upload-widget';

/**
 * [22.4.2] Storybook isn't wired for `client-admin/**` today (only
 * `ui/src/**` is globbed in) — same gap `import-preview.stories.tsx` and
 * `-create-school-wizard.stories.tsx` note. Written anyway so it's ready
 * once that's fixed.
 */
const meta: Meta<typeof FileUploadWidget> = {
  title: 'Homework/FileUploadWidget',
  component: FileUploadWidget,
};
export default meta;

type Story = StoryObj<typeof FileUploadWidget>;

export const Empty: Story = {
  args: {
    onFilesSelected: () => {},
  },
};

export const WithFiles: Story = {
  args: {
    existingFiles: [
      { storage_key: 'k1', filename: 'homework-notes.pdf', size: 204800 },
      { storage_key: 'k2', filename: 'page-photo.jpg', size: 1048576 },
    ],
    onFilesSelected: () => {},
    onRemoveExisting: () => {},
  },
};

export const ErrorState: Story = {
  render: (args) => {
    // The widget derives its own errors from picked files; this story
    // documents the visual by pre-seeding an existing file list long
    // enough that the next pick would exceed the cap — see the
    // "enforces the 10-file cap" test for the exact trigger.
    const existingFiles = Array.from({ length: 10 }, (_, i) => ({
      storage_key: `k${i}`,
      filename: `attachment-${i}.pdf`,
      size: 1024,
    }));
    return <FileUploadWidget {...args} existingFiles={existingFiles} />;
  },
  args: {
    onFilesSelected: () => {},
  },
};

export const Disabled: Story = {
  args: {
    existingFiles: [{ storage_key: 'k1', filename: 'homework-notes.pdf', size: 204800 }],
    onFilesSelected: () => {},
    disabled: true,
  },
};

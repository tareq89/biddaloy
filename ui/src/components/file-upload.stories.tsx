import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState } from 'react';

import { rtlDecorator } from '../../.storybook/rtl-decorator';

import { FileUpload, type FileUploadItem } from './file-upload';

const meta: Meta<typeof FileUpload> = {
  title: 'Components/FileUpload',
  component: FileUpload,
  tags: ['autodocs'],
};

export default meta;
type Story = StoryObj<typeof FileUpload>;

function makeFile(name: string): File {
  return new File(['content'], name, { type: 'text/csv' });
}

function Demo({ initialItems = [] }: { initialItems?: FileUploadItem[] }) {
  const [items, setItems] = useState<FileUploadItem[]>(initialItems);
  return (
    <FileUpload
      aria-label="Attachments"
      items={items}
      onFilesSelected={(files) =>
        setItems((prev) => [
          ...prev,
          ...files.map((file) => ({ id: crypto.randomUUID(), file, progress: 0 })),
        ])
      }
      onRemove={(file) => setItems((prev) => prev.filter((item) => item.file !== file))}
    />
  );
}

/** No files selected yet. */
export const Empty: Story = {
  render: () => <Demo />,
};

export const Default: Story = {
  render: () => (
    <Demo initialItems={[{ id: 'roster', file: makeFile('roster.csv'), progress: 100 }]} />
  ),
};

export const Loading: Story = {
  name: 'Loading (upload in progress)',
  render: () => (
    <Demo initialItems={[{ id: 'roster', file: makeFile('roster.csv'), progress: 42 }]} />
  ),
};

/** Stands in for this issue's "error" state category. */
export const ErrorState: Story = {
  render: () => (
    <Demo
      initialItems={[
        { id: 'roster', file: makeFile('roster.csv'), error: 'File exceeds the 5 MB limit' },
      ]}
    />
  ),
};

/** No dedicated "Disabled" story: the trigger is a `Button`, whose own
 * `disabled` state is already covered in `button.stories.tsx`. */

export const RightToLeft: Story = {
  render: () => (
    <FileUpload
      aria-label="সংযুক্তি"
      chooseLabel="ফাইল নির্বাচন করুন"
      items={[{ id: 'roster', file: makeFile('roster.csv'), progress: 100 }]}
      onFilesSelected={() => {}}
    />
  ),
  decorators: [rtlDecorator],
};

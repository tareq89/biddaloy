import type { Meta, StoryObj } from '@storybook/react-vite';

import { rtlDecorator } from '../../.storybook/rtl-decorator';

import { ImageViewer } from './image-viewer';

const meta: Meta<typeof ImageViewer> = {
  title: 'Components/ImageViewer',
  component: ImageViewer,
  tags: ['autodocs'],
};

export default meta;
type Story = StoryObj<typeof ImageViewer>;

const png = (fill: string) =>
  `data:image/svg+xml,${encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" width="800" height="1000"><rect width="800" height="1000" fill="${fill}"/></svg>`,
  )}`;

const labels = {
  openFile: 'Open file',
  zoomIn: 'Zoom in',
  zoomOut: 'Zoom out',
  previous: 'Previous',
  next: 'Next',
};

export const Images: Story = {
  args: {
    labels,
    files: [
      { url: png('#cfe8ff'), contentType: 'image/png', label: 'bKash receipt' },
      { url: png('#ffe3cf'), contentType: 'image/png', label: 'Bank slip' },
    ],
  },
};

export const WithPdf: Story = {
  args: {
    labels,
    files: [
      { url: png('#cfe8ff'), contentType: 'image/png', label: 'bKash receipt' },
      { url: '/proof.pdf', contentType: 'application/pdf', label: 'Bank statement' },
    ],
  },
};

export const Rtl: Story = { ...Images, decorators: [rtlDecorator] };

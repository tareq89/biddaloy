import type { Meta, StoryObj } from '@storybook/react-vite';

import { rtlDecorator } from '../../.storybook/rtl-decorator';

import { SkipLink } from './skip-link';

const meta: Meta<typeof SkipLink> = {
  title: 'Components/SkipLink',
  component: SkipLink,
  tags: ['autodocs'],
  args: {
    targetId: 'story-main-content',
    children: 'Skip to main content',
  },
  parameters: {
    docs: {
      description: {
        component:
          'Visually hidden until it receives keyboard focus — press Tab from the canvas to reveal it.',
      },
    },
  },
};

export default meta;
type Story = StoryObj<typeof SkipLink>;

export const Default: Story = {
  render: (args) => (
    <div>
      <SkipLink {...args} />
      <nav aria-label="Story nav" className="mb-4 flex gap-2">
        <a href="#story-nav-1" className="text-primary underline">
          Nav link one
        </a>
        <a href="#story-nav-2" className="text-primary underline">
          Nav link two
        </a>
      </nav>
      <main id="story-main-content" tabIndex={-1} className="rounded-md border border-border p-4">
        Page content — Tab from the top of this story to reveal the skip link before it reaches the
        nav links above.
      </main>
    </div>
  ),
};

export const RightToLeft: Story = {
  args: { targetId: 'story-main-content-rtl', children: 'মূল বিষয়বস্তুতে যান' },
  render: (args) => (
    <div>
      <SkipLink {...args} />
      <main
        id="story-main-content-rtl"
        tabIndex={-1}
        className="rounded-md border border-border p-4"
      >
        পৃষ্ঠার বিষয়বস্তু — এই গল্পের শুরু থেকে Tab চাপুন স্কিপ লিংক দেখতে।
      </main>
    </div>
  ),
  decorators: [rtlDecorator],
};

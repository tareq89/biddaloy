import type { Meta, StoryObj } from '@storybook/react-vite';

import { TestEnvironmentNotice } from './test-environment-notice';

const meta = {
  title: 'Demo/TestEnvironmentNotice',
  component: TestEnvironmentNotice,
  parameters: { layout: 'fullscreen' },
  decorators: [
    (Story, { parameters }) => {
      const env = parameters.sentryEnvironment as string;
      window.__BIDDALOY_CONFIG__ = {
        sentryEnvironment: env,
        messageSinkUrl: 'https://inbox-demo.example.com',
      };
      try {
        sessionStorage.setItem('test-inbox-notice', parameters.collapsed ? '1' : '0');
      } catch {
        // Storage blocked: the story shows the open bar.
      }
      return (
        <div className="relative h-24">
          <Story />
        </div>
      );
    },
  ],
} satisfies Meta<typeof TestEnvironmentNotice>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Demo site: info tone. */
export const Demo: Story = { parameters: { sentryEnvironment: 'demo' } };

/** Staging site: warning tone. */
export const Staging: Story = { parameters: { sentryEnvironment: 'staging' } };

/** Phone width: the text wraps and the link stays a 44 px target. */
export const Phone: Story = {
  parameters: {
    sentryEnvironment: 'demo',
    viewport: { defaultViewport: 'mobile1' },
  },
  globals: { viewport: { value: 'mobile1', isRotated: false } },
};

/** Collapsed to the pill beside where the demo ribbon sits. */
export const Collapsed: Story = { parameters: { sentryEnvironment: 'demo', collapsed: true } };

import type { Meta, StoryObj } from '@storybook/react-vite';
import { fn } from 'storybook/test';

import { Turnstile } from './turnstile';

/**
 * [13.5.1] The sign-up robot check when its script cannot load (blocked,
 * offline). The script request is failed on purpose, so the story shows the
 * inline message whatever the network does.
 */
const meta: Meta<typeof Turnstile> = {
  title: 'Features/Registration/Turnstile',
  component: Turnstile,
  args: { siteKey: 'story-site-key', onToken: fn() },
  beforeEach: () => {
    const append = document.head.appendChild.bind(document.head);
    document.head.appendChild = <T extends Node>(node: T): T => {
      if (node instanceof HTMLScriptElement && node.src.includes('turnstile')) {
        queueMicrotask(() => void node.dispatchEvent(new Event('error')));
        return node;
      }
      return append(node);
    };
    return () => {
      document.head.appendChild = append;
    };
  },
};
export default meta;
type Story = StoryObj<typeof Turnstile>;

export const ScriptBlocked: Story = {};

export const ScriptBlockedBangla: Story = { globals: { locale: 'bn' } };

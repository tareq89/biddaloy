import type { Meta, StoryObj } from '@storybook/react-vite';
import { http, HttpResponse, delay } from 'msw';

import { PresetWarningBanner } from './PresetWarningBanner';

const meta: Meta<typeof PresetWarningBanner> = { component: PresetWarningBanner };
export default meta;
type Story = StoryObj<typeof PresetWarningBanner>;

const handler = (fn: Parameters<typeof http.get>[1]) => ({
  msw: { handlers: [http.get('/api/v1/presets/status', fn)] },
});

/** Shown: the school has an applied preset. */
export const Applied: Story = {
  parameters: handler(() =>
    HttpResponse.json({
      state: 'APPLIED',
      preset: { id: 'bd/nctb', version: '2026.1', appliedAt: '2026-01-01T00:00:00Z' },
    }),
  ),
};

/** Renders nothing: no preset applied. */
export const Available: Story = {
  parameters: handler(() => HttpResponse.json({ state: 'AVAILABLE' })),
};

/** Renders nothing: school has its own setup. */
export const Custom: Story = { parameters: handler(() => HttpResponse.json({ state: 'CUSTOM' })) };

/** Renders nothing while the status loads. */
export const Loading: Story = {
  parameters: handler(async () => {
    await delay('infinite');
  }),
};

/** Renders nothing if the status call fails. */
export const LoadError: Story = {
  parameters: handler(() =>
    HttpResponse.json({ message: 'Something went wrong.' }, { status: 500 }),
  ),
};

import type { SchoolLabels } from '@biddaloy/shared';
import { Toaster } from '@biddaloy/ui/components';
import type { SchoolProfile } from '@biddaloy/ui/hooks';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { http, HttpResponse, delay } from 'msw';
import { expect, userEvent, within } from 'storybook/test';

import { WordsTab } from './WordsTab';

/** [77.4.04] D17/D18/D30: Settings › Modules & words › Words. The profile comes from MSW. */
const profile = (labels: SchoolLabels = {}): SchoolProfile =>
  ({
    name: 'Demo school',
    slug: 'demo',
    modules: { platform: {}, school: {} },
    labels,
  }) as SchoolProfile;

const handlers = (
  p: SchoolProfile,
  patch: Parameters<typeof http.patch>[1] = () => HttpResponse.json({ version: 1 }),
) => [
  http.get('/api/v1/schools/me/profile', () => HttpResponse.json(p)),
  http.patch('/api/v1/schools/:id/settings', patch),
];

const meta: Meta<typeof WordsTab> = {
  title: 'Settings/ModulesWords/WordsTab',
  component: WordsTab,
  args: { schoolId: 'school-1' },
  decorators: [
    (Story) => (
      <>
        <Story />
        <Toaster />
      </>
    ),
  ],
  parameters: { msw: { handlers: handlers(profile()) } },
};
export default meta;

type Story = StoryObj<typeof WordsTab>;

/** Every word is still the stock word. */
export const Stock: Story = {};

/** The school renamed Section to Batch. */
export const Edited: Story = {
  parameters: {
    msw: {
      handlers: handlers(
        profile({ section: { en: { one: 'Batch', other: 'Batches' }, bn: 'ব্যাচ' } }),
      ),
    },
  },
};

/** One click on the suggestion fills the three fields and the example. */
export const SuggestionApplied: Story = {
  play: async ({ canvasElement }) => {
    const c = within(canvasElement);
    await userEvent.click(await c.findByRole('button', { name: 'ব্যাচ / Batch' }));
    await expect(c.getByText('3 Batches')).toBeTruthy();
  },
};

/** Save hangs: the button is held. */
export const Saving: Story = {
  parameters: {
    msw: {
      handlers: handlers(profile(), async () => {
        await delay('infinite');
        return HttpResponse.json({});
      }),
    },
  },
  play: async ({ canvasElement }) => {
    const c = within(canvasElement);
    await userEvent.click(await c.findByRole('button', { name: 'ব্যাচ / Batch' }));
    await userEvent.click(c.getByRole('button', { name: 'Save' }));
  },
};

/** Save fails: the typed words stay and the form says "Not saved". */
export const SaveError: Story = {
  parameters: {
    msw: {
      handlers: handlers(profile(), () =>
        HttpResponse.json({ statusCode: 400, message: 'no', requestId: 'r' }, { status: 400 }),
      ),
    },
  },
  play: async ({ canvasElement }) => {
    const c = within(canvasElement);
    await userEvent.click(await c.findByRole('button', { name: 'ব্যাচ / Batch' }));
    await userEvent.click(c.getByRole('button', { name: 'Save' }));
  },
};

/** 41 characters: Save is refused with a message under the field. */
export const ValidationError: Story = {
  play: async ({ canvasElement }) => {
    const c = within(canvasElement);
    const input = (await c.findAllByLabelText('English (one)'))[0]!;
    await userEvent.clear(input);
    await userEvent.type(input, 'x'.repeat(41));
    await userEvent.click(c.getByRole('button', { name: 'Save' }));
  },
};

/** 390 px: each word is a card, controls 44 px tall. */
export const Phone: Story = {
  globals: { viewport: { value: 'mobile1', isRotated: false } },
  parameters: { viewport: { defaultViewport: 'mobile1' } },
};

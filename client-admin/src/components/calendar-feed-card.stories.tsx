import { setActiveRole } from '@biddaloy/ui/api';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { http, HttpResponse, delay } from 'msw';

import { CalendarFeedCard } from './calendar-feed-card';

// `CalendarFeedCard` self-gates on `Permission.CALENDAR_READ` (see its
// own doc comment) — every story here needs an active role that holds
// it. The no-permission case (renders nothing) is covered by
// `calendar-feed-card.test.tsx` instead, since there's nothing to show
// in Storybook.
setActiveRole('TEACHER');

const FEED_URL = 'webcal://app.biddaloy.test/api/v1/calendar/feed/tok_abc123';

const meta: Meta<typeof CalendarFeedCard> = {
  component: CalendarFeedCard,
  parameters: {
    msw: {
      handlers: [
        http.get('/api/v1/calendar/feed', () => HttpResponse.json({ url: FEED_URL })),
        http.post('/api/v1/calendar/feed/regenerate', () =>
          HttpResponse.json({
            url: 'webcal://app.biddaloy.test/api/v1/calendar/feed/tok_new456',
          }),
        ),
      ],
    },
  },
};

export default meta;
type Story = StoryObj<typeof CalendarFeedCard>;

/** Loaded, masked link with Copy and Regenerate available. */
export const Populated: Story = {};

export const Loading: Story = {
  parameters: {
    msw: {
      handlers: [
        http.get('/api/v1/calendar/feed', async () => {
          await delay('infinite');
        }),
      ],
    },
  },
};

export const LoadError: Story = {
  parameters: {
    msw: {
      handlers: [
        http.get('/api/v1/calendar/feed', () =>
          HttpResponse.json({ message: 'Something went wrong.' }, { status: 500 }),
        ),
      ],
    },
  },
};

/** Regenerate confirm dialog fails — `MutationErrorMessage` shows inline. */
export const RegenerateError: Story = {
  parameters: {
    msw: {
      handlers: [
        http.get('/api/v1/calendar/feed', () => HttpResponse.json({ url: FEED_URL })),
        http.post('/api/v1/calendar/feed/regenerate', () =>
          HttpResponse.json({ message: 'Something went wrong.' }, { status: 500 }),
        ),
      ],
    },
  },
  play: async ({ canvasElement }) => {
    const { within, userEvent } = await import('storybook/test');
    const canvas = within(canvasElement);
    await userEvent.click(await canvas.findByRole('button', { name: 'Regenerate link' }));
    const dialog = within(canvasElement.ownerDocument.body);
    await userEvent.click(await dialog.findByRole('button', { name: 'Regenerate' }));
  },
};

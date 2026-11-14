import type { Meta, StoryObj } from '@storybook/react-vite';
import { delay, http, HttpResponse } from 'msw';
import { fn } from 'storybook/test';

import { withMemoryRouter } from '../../../../../ui/.storybook/router-decorator';

import { COACHING_CHANGES, KIND_FIXTURES, NO_CHANGES } from './kind-fixtures';
import { KindPreviewPage } from './KindPreviewPage';
import type { KindChanges } from './use-institution-kinds';

/** [77.4.02] D28/D30: one institution kind's preview, a full-page modal. Apply is the only write. */
function api(
  preview: KindChanges,
  apply: Parameters<typeof http.post>[1] = () => HttpResponse.json(COACHING_CHANGES),
) {
  return {
    msw: {
      handlers: [
        http.get('/api/v1/institution-kinds', () => HttpResponse.json(KIND_FIXTURES)),
        http.post('/api/v1/institution-kinds/:id/preview', () => HttpResponse.json(preview)),
        http.post('/api/v1/institution-kinds/:id/apply', apply),
      ],
    },
  };
}

const meta: Meta<typeof KindPreviewPage> = {
  title: 'Settings/ModulesWords/KindPreviewPage',
  component: KindPreviewPage,
  decorators: [withMemoryRouter(['/'])],
  args: { kindId: 'coaching', onClose: fn() },
};
export default meta;

type Story = StoryObj<typeof KindPreviewPage>;

export const Changes: Story = { parameters: api(COACHING_CHANGES) };

export const NoChanges: Story = { parameters: api(NO_CHANGES) };

/** Click Apply: the person stays here and sees the fixed sentence, never the server's text. */
export const ApplyError: Story = {
  parameters: api(COACHING_CHANGES, () =>
    HttpResponse.json({ statusCode: 500, message: 'x', requestId: 'r' }, { status: 500 }),
  ),
};

export const Loading: Story = {
  parameters: {
    msw: {
      handlers: [
        http.get('/api/v1/institution-kinds', () => HttpResponse.json(KIND_FIXTURES)),
        http.post('/api/v1/institution-kinds/:id/preview', async () => {
          await delay('infinite');
          return HttpResponse.json(NO_CHANGES);
        }),
      ],
    },
  },
};

export const PreviewError: Story = {
  args: { kindId: 'nope' },
  parameters: api(COACHING_CHANGES),
};

/** 390 px: the two lists stack, the footer buttons stay 44 px. */
export const Phone: Story = {
  parameters: { ...api(COACHING_CHANGES), viewport: { defaultViewport: 'mobile1' } },
  globals: { viewport: { value: 'mobile1', isRotated: false } },
};

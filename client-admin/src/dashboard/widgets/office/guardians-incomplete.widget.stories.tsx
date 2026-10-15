import type { Meta, StoryObj } from '@storybook/react-vite';

import { withMemoryRouter } from '../../../../../ui/.storybook/router-decorator';

import {
  GuardiansIncompleteView,
  type GuardiansIncompleteDto,
} from './guardians-incomplete.widget';

const data: GuardiansIncompleteDto = { incomplete_count: 23, total_count: 1410 };

const meta: Meta<typeof GuardiansIncompleteView> = {
  title: 'Dashboard/Widgets/GuardiansIncomplete',
  component: GuardiansIncompleteView,
  decorators: [
    withMemoryRouter(['/dashboard']),
    (Story) => (
      <div className="max-w-md">
        <Story />
      </div>
    ),
  ],
  args: { data, variant: 'full' },
};
export default meta;
type Story = StoryObj<typeof GuardiansIncompleteView>;

export const Full: Story = { globals: { locale: 'bn', theme: 'dark' } };
export const Tile: Story = { args: { variant: 'tile' } };
export const Zero: Story = { args: { data: { incomplete_count: 0, total_count: 1410 } } };
export const Loading: Story = { args: { data: undefined, loading: true } };
export const Error: Story = { args: { data: undefined, failed: true, onRetry: () => undefined } };

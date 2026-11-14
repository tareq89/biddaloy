import type { Meta, StoryObj } from '@storybook/react-vite';
import { fn } from 'storybook/test';

import { withMemoryRouter } from '../../../../../ui/.storybook/router-decorator';

import { KIND_FIXTURES } from './kind-fixtures';
import { KindCards } from './KindCards';

/** [77.4.02] D28: the eight institution-kind cards on top of Settings › Modules & words. */
const meta: Meta<typeof KindCards> = {
  title: 'Settings/ModulesWords/KindCards',
  component: KindCards,
  decorators: [withMemoryRouter(['/'])],
  args: { kinds: KIND_FIXTURES, onSelect: fn(), onRetry: fn() },
};
export default meta;

type Story = StoryObj<typeof KindCards>;

/** Qawmi madrasa, College and Technical institute carry the "Not verified yet" badge (D25). */
export const Default: Story = {};

export const Selected: Story = { args: { selectedId: 'coaching' } };

export const Loading: Story = { args: { kinds: undefined, loading: true } };

export const LoadError: Story = { args: { kinds: undefined, error: true } };

/** 390 px: one card per row, 44 px tall minimum. */
export const Phone: Story = {
  globals: { viewport: { value: 'mobile1', isRotated: false } },
  parameters: { viewport: { defaultViewport: 'mobile1' } },
};

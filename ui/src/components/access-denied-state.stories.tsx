import type { Meta, StoryObj } from '@storybook/react-vite';

import { darkDecorator, darkDecoratorParameters } from '../../.storybook/dark-decorator';

import { AccessDeniedState } from './access-denied-state';

const meta: Meta<typeof AccessDeniedState> = {
  title: 'Components/AccessDeniedState',
  component: AccessDeniedState,
  tags: ['autodocs'],
};

export default meta;
type Story = StoryObj<typeof AccessDeniedState>;

/** [8.14.17]'s default — `common:accessDenied`'s copy, an outline
 * "Back to dashboard" button. What every gated staff route renders
 * without an override. */
export const Default: Story = {
  args: { onAction: () => {} },
};

/** The embedded/no-router case: omit `onAction` and no button renders at
 * all, same convention `RouteStatusState.onHome` follows. This is the
 * component's own default (no `onAction` in `meta.args`), not an override. */
export const WithoutAction: Story = {};

/** `/audit-logs`'s override — the one route in [8.14.17]'s plan whose
 * refusal names what it's refusing rather than using the generic copy. */
export const CustomExplanation: Story = {
  args: {
    onAction: () => {},
    explanation: "Only an administrator can read this school's audit trail.",
  },
};

/** Proves the default copy is really translated, not English hardcoded
 * with a translated override layered on top — switch the Storybook
 * locale toolbar to `bn` and this story's copy changes with it. */
export const Bengali: Story = {
  args: { onAction: () => {} },
  globals: { locale: 'bn' },
};

/** Dark half of the `bg-muted`/`text-muted-foreground`/`border-border-subtle`
 * contrast pairs this component reuses from `RouteStatusState`. */
export const Dark: Story = {
  args: { onAction: () => {} },
  decorators: [darkDecorator],
  parameters: darkDecoratorParameters,
};

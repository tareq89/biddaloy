import type { Meta, StoryObj } from '@storybook/react-vite';

import { withMemoryRouter } from '../../.storybook/router-decorator';

import { RowActions, RowActionsLayoutContext, type RowAction } from './row-actions';

const meta: Meta<typeof RowActions> = {
  title: 'Components/RowActions',
  component: RowActions,
  tags: ['autodocs'],
  decorators: [withMemoryRouter(['/'])],
};

export default meta;
type Story = StoryObj<typeof RowActions>;

const noop = () => {};
const VIEW: RowAction = { intent: 'view', label: 'View', to: '/students/1' };
const EDIT: RowAction = { intent: 'edit', label: 'Edit', onClick: noop };
const PRINT: RowAction = { intent: 'print', label: 'Print', onClick: noop };
const DUPLICATE: RowAction = { intent: 'duplicate', label: 'Duplicate', onClick: noop };
const DELETE: RowAction = { intent: 'delete', label: 'Delete', onClick: noop };

export const TwoActions: Story = { args: { actions: [VIEW, EDIT] } };
export const ThreeActions: Story = { args: { actions: [VIEW, EDIT, DELETE] } };
/** More than three: the extras move into the More menu, delete last below a separator. */
export const FiveActions: Story = {
  args: { actions: [VIEW, EDIT, PRINT, DUPLICATE, DELETE] },
};
/** Card layout (C12): labels stay visible. */
export const CardLayout: Story = {
  args: { actions: [VIEW, EDIT, DELETE] },
  parameters: { viewport: { defaultViewport: 'mobile1' } },
  render: (args) => (
    <RowActionsLayoutContext.Provider value="labelled">
      <RowActions {...args} />
    </RowActionsLayoutContext.Provider>
  ),
};

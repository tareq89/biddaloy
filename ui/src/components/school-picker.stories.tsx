/** No "Loading"/"Error"/"Disabled" story: `SchoolPicker` is presentational
 * only — the caller already has every membership in hand (decoded off the
 * access token, see the component's own header comment) before this ever
 * renders, so there's no network state to represent here. */
import { UserRole } from '@biddaloy/shared';
import type { Meta, StoryObj } from '@storybook/react-vite';

import { rtlDecorator } from '../../.storybook/rtl-decorator';

import { SchoolPicker } from './school-picker';

const meta: Meta<typeof SchoolPicker> = {
  title: 'Components/SchoolPicker',
  component: SchoolPicker,
  tags: ['autodocs'],
  args: {
    onSelect: () => {},
  },
};

export default meta;
type Story = StoryObj<typeof SchoolPicker>;

export const Default: Story = {
  args: {
    schools: [
      { tenantId: 'tenant-1', name: 'Greenview School', role: UserRole.ADMIN },
      { tenantId: 'tenant-2', name: 'Rose Valley School', role: UserRole.TEACHER },
    ],
  },
};

export const ThreeSchools: Story = {
  args: {
    schools: [
      { tenantId: 'tenant-1', name: 'Greenview School', role: UserRole.ADMIN },
      { tenantId: 'tenant-2', name: 'Rose Valley School', role: UserRole.TEACHER },
      { tenantId: 'tenant-3', name: 'Sunrise Academy', role: UserRole.PARENT },
    ],
  },
};

export const RightToLeft: Story = {
  args: {
    schools: [
      { tenantId: 'tenant-1', name: 'Greenview School', role: UserRole.ADMIN },
      { tenantId: 'tenant-2', name: 'Rose Valley School', role: UserRole.TEACHER },
    ],
  },
  decorators: [rtlDecorator],
};

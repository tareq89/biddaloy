import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState } from 'react';

import { rtlDecorator } from '../../.storybook/rtl-decorator';
import { REGION_BD_BN, REGION_BD_EN, type RegionConfig } from '../i18n/region-config';

import { DatePicker } from './date-picker';

const meta: Meta<typeof DatePicker> = {
  title: 'Components/DatePicker',
  component: DatePicker,
  tags: ['autodocs'],
};

export default meta;
type Story = StoryObj<typeof DatePicker>;

function Demo({ config = REGION_BD_EN, initial }: { config?: RegionConfig; initial?: Date }) {
  const [value, setValue] = useState<Date | undefined>(initial);
  return (
    <DatePicker
      aria-label="Enrollment date"
      value={value}
      onValueChange={setValue}
      config={config}
    />
  );
}

export const Default: Story = {
  render: () => <Demo initial={new Date(2024, 0, 15)} />,
};

/** No date entered yet. */
export const Empty: Story = {
  render: () => <Demo />,
};

/** No dedicated "Disabled"/"Loading"/"Error" story: those states belong to
 * the composed `Input` (already covered in `input.stories.tsx`) and
 * `FormField` (invalid/error rendering) — `DatePicker` itself is stateless
 * beyond the value it holds. */

export const RightToLeft: Story = {
  render: () => <Demo config={REGION_BD_BN} initial={new Date(2024, 0, 15)} />,
  decorators: [rtlDecorator],
};

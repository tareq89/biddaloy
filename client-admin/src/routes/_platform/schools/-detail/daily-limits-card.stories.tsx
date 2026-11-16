import type { Meta, StoryObj } from '@storybook/react-vite';

import { DailyLimitsCard } from './daily-limits-card';

/**
 * Epic 60 #4256: the cockpit "Daily limits" card. It loads its own data, so Storybook shows the
 * loading state (no MSW here, same gap as `seats-card.stories.tsx`); the loaded, school-override,
 * saving and error states are asserted in `daily-limits-card.test.tsx`.
 */
const meta: Meta<typeof DailyLimitsCard> = { component: DailyLimitsCard };
export default meta;

type Story = StoryObj<typeof DailyLimitsCard>;

export const School: Story = { args: { schoolId: '00000000-0000-4000-8000-000000000001' } };
export const PlatformDefaults: Story = {};

import type { Decorator, Meta, StoryObj } from '@storybook/react-vite';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import { withMemoryRouter } from '../../.storybook/router-decorator';
import { academicYearKeys } from '../hooks/academic-years';
import { academicYearFactory } from '../test/factories';

import { ClosedYearNotice } from './closed-year-notice';

/** Seeds the year into the query cache so the story needs no network. */
function withYear(closedAt: string | null): Decorator {
  const Seeded: Decorator = (Story) => {
    const client = new QueryClient({ defaultOptions: { queries: { staleTime: Infinity } } });
    client.setQueryData(
      academicYearKeys.detail('year-1'),
      academicYearFactory({ id: 'year-1', name: '2026', closed_at: closedAt }),
    );
    return (
      <QueryClientProvider client={client}>
        <Story />
      </QueryClientProvider>
    );
  };
  return Seeded;
}

const meta: Meta<typeof ClosedYearNotice> = {
  title: 'Components/ClosedYearNotice',
  component: ClosedYearNotice,
  tags: ['autodocs'],
  args: { academicYearId: 'year-1' },
  // The notice links to the year, so it needs a router even though nothing navigates.
  decorators: [withMemoryRouter(['/'])],
};

export default meta;
type Story = StoryObj<typeof ClosedYearNotice>;

/** The year is closed: the info bar explains why Save is off. */
export const Closed: Story = { decorators: [withYear('2026-12-31T00:00:00.000Z')] };

/** An open year renders nothing. */
export const Open: Story = { decorators: [withYear(null)] };

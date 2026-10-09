import { setActiveRole } from '@biddaloy/ui/api';
import type { Meta, StoryObj } from '@storybook/react-vite';
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  RouterProvider,
} from '@tanstack/react-router';
import { http, HttpResponse } from 'msw';

import { AttendancePendingCard } from './attendance-pending-card';

// The card renders a real `Link`, so each story mounts a minimal router.
function CardWithRouter() {
  const rootRoute = createRootRoute();
  const indexRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/',
    component: AttendancePendingCard,
  });
  const attendanceRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/attendance',
    component: () => <p />,
  });
  const router = createRouter({
    routeTree: rootRoute.addChildren([indexRoute, attendanceRoute]),
    history: createMemoryHistory({ initialEntries: ['/'] }),
  });
  return <RouterProvider router={router} />;
}

// The card hides itself without ATTENDANCE_READ (covered by its test).
setActiveRole('ADMIN');

function section(overrides: Record<string, unknown>) {
  return {
    section_id: 's-1',
    section_name: 'A',
    class_id: 'c-1',
    class_name: 'Class 1',
    student_count: 30,
    class_teacher_name: null,
    is_working_day: true,
    today: null,
    ...overrides,
  };
}

const finalized = {
  state: 'FINALIZED',
  present: 28,
  absent: 2,
  late: 0,
  leave: 0,
  unmarked: 0,
  marked_at: null,
};

function sections(list: Array<Record<string, unknown>>) {
  return {
    msw: { handlers: [http.get('/api/v1/attendance/my-sections', () => HttpResponse.json(list))] },
  };
}

const meta: Meta<typeof CardWithRouter> = { component: CardWithRouter };
export default meta;
type Story = StoryObj<typeof CardWithRouter>;

export const Pending: Story = {
  parameters: sections([
    section({ section_id: 's-1', today: finalized }),
    section({ section_id: 's-2' }),
    section({ section_id: 's-3' }),
  ]),
};

export const AllDone: Story = {
  parameters: sections([section({ today: finalized })]),
};

export const Holiday: Story = {
  parameters: sections([section({ is_working_day: false })]),
};

export const Loading: Story = {
  parameters: {
    msw: {
      handlers: [http.get('/api/v1/attendance/my-sections', () => new Promise(() => undefined))],
    },
  },
};

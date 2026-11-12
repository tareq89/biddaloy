import { setActiveRole, setActiveTenant } from '@biddaloy/ui/api';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { delay, http, HttpResponse } from 'msw';

import { SupportAccessSection } from './SupportAccessSection';

/** [99.G4.04] Settings › Biddaloy support access. Same "client-admin isn't globbed into a running Storybook yet" gap as the other settings stories. */
const settings = (mode: 'allowed' | 'ask' | 'blocked') => ({
  mode,
  confirmedAt: '2026-11-01T10:00:00.000Z',
  confirmedByName: 'Salma',
  textVersion: 1,
  currentTextVersion: 1,
  needsConfirmation: false,
});

const sessions = [
  {
    id: 's1',
    ownerName: 'Owner',
    startedAt: '2026-11-11T10:00:00.000Z',
    endedAt: null,
    status: 'ACTIVE',
    kind: 'NORMAL',
    viewOnly: false,
    role: 'TEACHER',
    personName: 'Rahim',
    reason: 'Bug check',
    changedCount: 3,
  },
  {
    id: 's2',
    ownerName: 'Owner',
    startedAt: '2026-11-01T10:00:00.000Z',
    endedAt: '2026-11-01T10:18:00.000Z',
    status: 'ENDED',
    kind: 'EMERGENCY',
    viewOnly: true,
    role: 'OFFICE_STAFF',
    personName: 'Karim',
    reason: 'Locked out',
    changedCount: 0,
  },
];

const request = {
  id: 'r1',
  kind: 'ASK',
  ownerName: 'Owner',
  role: 'TEACHER',
  personName: 'Rahim',
  reason: 'Fee report looks wrong',
  requestedAt: '2026-11-12T09:00:00.000Z',
  expiresAt: '2026-11-13T09:00:00.000Z',
  status: 'REQUESTED',
};

function api(mode: 'allowed' | 'ask' | 'blocked', rows: unknown[], requests: unknown[] = []) {
  return {
    msw: {
      handlers: [
        http.get('/api/v1/support-access/settings', () => HttpResponse.json(settings(mode))),
        http.get('/api/v1/support-access/sessions', () => HttpResponse.json(rows)),
        http.get('/api/v1/support-access/platform-actions', () =>
          HttpResponse.json(
            rows.length
              ? [
                  {
                    id: 'a1',
                    at: '2026-11-05T09:00:00.000Z',
                    actorName: 'Owner',
                    label: 'SMS credit added',
                    reason: 'Top up',
                  },
                ]
              : [],
          ),
        ),
        http.get('/api/v1/support-access/requests', () => HttpResponse.json(requests)),
      ],
    },
  };
}

const meta: Meta<typeof SupportAccessSection> = {
  title: 'Settings/SupportAccess',
  component: SupportAccessSection,
  loaders: [
    () => {
      setActiveTenant('school-1');
      setActiveRole('ADMIN');
    },
  ],
};
export default meta;

type Story = StoryObj<typeof SupportAccessSection>;

export const AskWithLiveLoginAndRequest: Story = { parameters: api('ask', sessions, [request]) };

export const Allowed: Story = { parameters: api('allowed', sessions) };

export const Blocked: Story = { parameters: api('blocked', []) };

export const EmptyHistory: Story = { parameters: api('ask', []) };

export const Loading: Story = {
  parameters: {
    msw: {
      handlers: [
        http.get('/api/v1/support-access/:rest*', async () => {
          await delay('infinite');
          return HttpResponse.json([]);
        }),
      ],
    },
  },
};

export const LoadError: Story = {
  parameters: {
    msw: {
      handlers: [
        http.get('/api/v1/support-access/:rest*', () =>
          HttpResponse.json({ statusCode: 500, message: 'x', requestId: 'r' }, { status: 500 }),
        ),
      ],
    },
  },
};

/** 390 px: choice cards stack, tables become cards, End is a full-height button. */
export const Phone: Story = {
  parameters: {
    ...api('ask', sessions, [request]),
    viewport: { defaultViewport: 'mobile1' },
  },
  globals: { viewport: { value: 'mobile1', isRotated: false } },
};

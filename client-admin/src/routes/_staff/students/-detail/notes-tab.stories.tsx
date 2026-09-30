import { setAccessToken, setActiveRole } from '@biddaloy/ui/api';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { http, HttpResponse, delay } from 'msw';

import { NotesTab } from './notes-tab';

// Delete is author/ADMIN only — ADMIN so the Delete button shows in `Populated`.
setActiveRole('ADMIN');
setAccessToken(`h.${btoa(JSON.stringify({ sub: 'user-me' }))}.s`);

const notes = [
  {
    id: 'note-1',
    body: 'Needs extra reading support. Spoke to the guardian on Sunday.',
    author: { id: 'user-me', name: 'Rahima Begum' },
    created_at: '2026-01-05T10:00:00.000Z',
  },
  {
    id: 'note-2',
    body: 'Won the inter-school quiz.',
    author: { id: 'user-other', name: 'Karim Sir' },
    created_at: '2026-01-02T09:30:00.000Z',
  },
];

const meta: Meta<typeof NotesTab> = {
  component: NotesTab,
  args: { studentId: 'student-1' },
  parameters: {
    msw: {
      handlers: [http.get('/api/v1/students/:id/notes', () => HttpResponse.json(notes))],
    },
  },
};

export default meta;
type Story = StoryObj<typeof NotesTab>;

export const Populated: Story = {};

export const Empty: Story = {
  parameters: {
    msw: { handlers: [http.get('/api/v1/students/:id/notes', () => HttpResponse.json([]))] },
  },
};

export const Loading: Story = {
  parameters: {
    msw: {
      handlers: [
        http.get('/api/v1/students/:id/notes', async () => {
          await delay('infinite');
        }),
      ],
    },
  },
};

export const Forbidden: Story = {
  parameters: {
    msw: {
      handlers: [
        http.get('/api/v1/students/:id/notes', () =>
          HttpResponse.json({ message: 'Forbidden' }, { status: 403 }),
        ),
      ],
    },
  },
};

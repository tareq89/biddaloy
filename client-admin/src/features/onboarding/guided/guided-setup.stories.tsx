import type { Meta, StoryObj } from '@storybook/react-vite';
import { http, HttpResponse } from 'msw';
import { expect, within } from 'storybook/test';

import { withMemoryRouter } from '../../../../../ui/.storybook/router-decorator';

import { GuidedSetup } from './guided-setup';

/**
 * [13.5.4] The guided path inside the welcome wizard's setup slot: one story per
 * question, the not-fresh curriculum state, a sections row that already exists,
 * and the phone layout. Switch the toolbar locale to see Bangla.
 */
const profile = http.get('/api/v1/schools/me/profile', () =>
  HttpResponse.json({
    name: 'Ananta School',
    name_bn: null,
    address: null,
    phone: null,
    email: null,
    registration_id: null,
    logo_url: null,
  }),
);
const presetStatus = (state: 'AVAILABLE' | 'CUSTOM') =>
  http.get('/api/v1/presets/status', () =>
    HttpResponse.json(state === 'CUSTOM' ? { state, blockers: [] } : { state }),
  );
const classes = http.get('/api/v1/classes', () =>
  HttpResponse.json({
    data: [
      { id: 'c1', name: 'Class 1' },
      { id: 'c2', name: 'Class 2' },
    ],
    total: 2,
    page: 1,
    limit: 100,
    totalPages: 1,
  }),
);
const sections = http.get('/api/v1/classes/:id/sections', ({ params }) =>
  HttpResponse.json(params.id === 'c2' ? [{ id: 's1', section_name: 'A', enrolled_count: 0 }] : []),
);

const base = '/welcome?step=setup&path=guided';
const phone = { viewport: { defaultViewport: 'mobile1' } };

const meta: Meta<typeof GuidedSetup> = {
  title: 'Features/Onboarding/GuidedSetup',
  component: GuidedSetup,
  parameters: { layout: 'padded', msw: { handlers: [profile, classes, sections] } },
};
export default meta;
type Story = StoryObj<typeof GuidedSetup>;

export const School: Story = {
  decorators: [withMemoryRouter([`${base}&q=1`])],
  play: async ({ canvasElement }) => {
    const body = within(canvasElement.ownerDocument.body);
    await expect(await body.findByLabelText('School name (English)')).toBeVisible();
  },
};

export const SchoolPhone: Story = {
  ...School,
  parameters: { ...meta.parameters, ...phone },
};

export const CurriculumNotFresh: Story = {
  decorators: [withMemoryRouter([`${base}&q=2`])],
  parameters: { ...meta.parameters, msw: { handlers: [presetStatus('CUSTOM')] } },
  play: async ({ canvasElement }) => {
    const body = within(canvasElement.ownerDocument.body);
    await expect(await body.findByRole('link', { name: 'Set up by hand' })).toBeVisible();
  },
};

export const SectionsExistingAndNew: Story = {
  decorators: [withMemoryRouter([`${base}&q=3`])],
  play: async ({ canvasElement }) => {
    const body = within(canvasElement.ownerDocument.body);
    await expect(await body.findByRole('button', { name: 'Create sections' })).toBeVisible();
  },
};

export const SectionsPhone: Story = {
  ...SectionsExistingAndNew,
  parameters: { ...meta.parameters, ...phone },
};

export const SectionsNoClasses: Story = {
  decorators: [withMemoryRouter([`${base}&q=3`])],
  parameters: {
    ...meta.parameters,
    msw: {
      handlers: [
        http.get('/api/v1/classes', () =>
          HttpResponse.json({ data: [], total: 0, page: 1, limit: 100, totalPages: 1 }),
        ),
      ],
    },
  },
};

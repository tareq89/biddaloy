import type { Meta, StoryObj } from '@storybook/react-vite';
import { http, HttpResponse } from 'msw';
import { expect, within } from 'storybook/test';

import { withMemoryRouter } from '../../../../../ui/.storybook/router-decorator';
import { KIND_FIXTURES, NO_CHANGES } from '../../../pages/settings/modules-words/kind-fixtures';

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

const NCTB = {
  id: 'bd/nctb',
  version: '2026.1',
  name: { en: 'NCTB National Curriculum', bn: 'এনসিটিবি' },
  board: { en: 'NCTB', bn: 'এনসিটিবি' },
  description: { en: 'Primary.', bn: 'প্রাথমিক।' },
  verified: true,
  country: 'BD',
  stages: [{ key: 'PRIMARY', name: { en: 'Primary', bn: 'প্রাথমিক' } }],
};
const kindHandlers = (
  apply: () => Promise<Response> | Response = () => HttpResponse.json(NO_CHANGES),
) => [
  presetStatus('AVAILABLE'),
  http.get('/api/v1/presets', () => HttpResponse.json([NCTB])),
  http.get('/api/v1/institution-kinds', () => HttpResponse.json(KIND_FIXTURES)),
  http.post('/api/v1/institution-kinds/:id/apply', apply),
];

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

/** No pack picked yet: no kind is selected and Skip is the only way on. */
export const CurriculumKindNone: Story = {
  decorators: [withMemoryRouter([`${base}&q=2`])],
  parameters: { ...meta.parameters, msw: { handlers: kindHandlers() } },
  play: async ({ canvasElement }) => {
    const body = within(canvasElement.ownerDocument.body);
    await expect(await body.findByRole('button', { name: /Secondary school/ })).toHaveAttribute(
      'aria-pressed',
      'false',
    );
  },
};

/** Choosing the NCTB pack pre-selects Secondary school. */
export const CurriculumKindFromPack: Story = {
  ...CurriculumKindNone,
  play: async ({ canvasElement }) => {
    const body = within(canvasElement.ownerDocument.body);
    const [choose] = await body.findAllByRole('button', { name: 'Choose' });
    choose!.click();
    await expect(await body.findByRole('button', { name: /Secondary school/ })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
  },
};

export const CurriculumKindFromPackPhone: Story = {
  ...CurriculumKindFromPack,
  parameters: { ...CurriculumKindNone.parameters, ...phone },
};

/** The apply is slow: the step button shows its busy state. */
export const CurriculumKindApplying: Story = {
  ...CurriculumKindNone,
  parameters: {
    ...meta.parameters,
    msw: { handlers: kindHandlers(() => new Promise<Response>(() => {})) },
  },
  play: async ({ canvasElement }) => {
    const body = within(canvasElement.ownerDocument.body);
    (await body.findByRole('button', { name: /Coaching centre/ })).click();
    (await body.findByRole('button', { name: 'Skip this step' })).click();
    await expect(await body.findByRole('button', { name: 'Skip this step' })).toBeDisabled();
  },
};

/** The apply failed: the sentence and the Settings pointer show; the next click moves on. */
export const CurriculumKindApplyFailed: Story = {
  ...CurriculumKindNone,
  parameters: {
    ...meta.parameters,
    msw: { handlers: kindHandlers(() => HttpResponse.json({ message: 'x' }, { status: 500 })) },
  },
  play: async ({ canvasElement }) => {
    const body = within(canvasElement.ownerDocument.body);
    (await body.findByRole('button', { name: /Coaching centre/ })).click();
    (await body.findByRole('button', { name: 'Skip this step' })).click();
    await expect(await body.findByRole('alert')).toBeVisible();
  },
};

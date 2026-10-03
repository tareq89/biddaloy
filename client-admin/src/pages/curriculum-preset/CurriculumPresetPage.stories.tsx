import type { PresetSummary } from '@biddaloy/shared';
import type { Meta, StoryObj } from '@storybook/react-vite';
import {
  createMemoryHistory,
  createRootRoute,
  createRouter,
  RouterProvider,
} from '@tanstack/react-router';
import * as React from 'react';

import { AppliedSummary } from './AppliedSummary';
import { ApplyOptionsForm, type ApplyOptions } from './ApplyOptionsForm';
import { BlockedState } from './BlockedState';
import { ConfirmApplyDialog } from './ConfirmApplyDialog';
import { PresetCards } from './PresetCards';

/**
 * [35.4.3] One story per state, rendered from props (no network) — same
 * "client-admin isn't globbed into a running Storybook yet" gap
 * `OrganisationSection.stories.tsx` notes. The full page (status + wizard)
 * is covered by `CurriculumPresetPage.test.tsx` against MSW.
 */
const meta: Meta = { title: 'Curriculum preset' };
export default meta;
type Story = StoryObj;

const NCTB: PresetSummary = {
  id: 'bd/nctb',
  version: '2026.1',
  name: { en: 'NCTB National Curriculum', bn: 'এনসিটিবি জাতীয় কারিকুলাম' },
  board: { en: 'NCTB', bn: 'এনসিটিবি' },
  description: { en: 'Primary to higher secondary.', bn: 'প্রাথমিক থেকে উচ্চ মাধ্যমিক।' },
  verified: true,
  country: 'BD',
  stages: [
    { key: 'PRIMARY', name: { en: 'Primary', bn: 'প্রাথমিক' } },
    { key: 'SECONDARY', name: { en: 'Secondary', bn: 'মাধ্যমিক' } },
  ],
  versions: [
    { key: 'Bangla', name: { en: 'Bangla', bn: 'বাংলা' } },
    { key: 'English', name: { en: 'English', bn: 'ইংরেজি' } },
  ],
};
const QAWMI: PresetSummary = {
  ...NCTB,
  id: 'bd/qawmi-madrasa',
  name: { en: 'Qawmi Madrasa', bn: 'কওমি মাদ্রাসা' },
  verified: false,
  stages: [{ key: 'IBTIDAYI', name: { en: 'Ibtidayi', bn: 'ইবতেদায়ি' } }],
};
delete (QAWMI as { versions?: unknown }).versions;

export const Available: Story = {
  render: () => (
    <PresetCards
      presets={[NCTB, QAWMI]}
      selectedId="bd/nctb"
      onSelect={() => {}}
      onPreview={() => {}}
    />
  ),
};

export const UnverifiedBadge: Story = {
  render: () => (
    <PresetCards presets={[QAWMI]} selectedId={null} onSelect={() => {}} onPreview={() => {}} />
  ),
};

function OptionsDemo({ summary }: { summary: PresetSummary }) {
  const [value, setValue] = React.useState<ApplyOptions>({
    stages: [],
    versions: [],
    startYear: '2026',
  });
  return <ApplyOptionsForm summary={summary} value={value} onChange={setValue} />;
}
export const OptionsNeedVersion: Story = { render: () => <OptionsDemo summary={NCTB} /> };
export const OptionsUnverifiedWarning: Story = { render: () => <OptionsDemo summary={QAWMI} /> };

export const Applying: Story = {
  render: () => (
    <ConfirmApplyDialog
      open
      onOpenChange={() => {}}
      presetName={NCTB.name.en}
      onConfirm={() => {}}
      pending
    />
  ),
};

export const ConfirmError: Story = {
  render: () => (
    <ConfirmApplyDialog
      open
      onOpenChange={() => {}}
      presetName={NCTB.name.en}
      onConfirm={() => {}}
      error
    />
  ),
};

export const Applied: Story = {
  render: () => (
    <AppliedSummary
      preset={{
        id: 'bd/nctb',
        version: '2026.1',
        appliedAt: '2026-10-01T09:00:00Z',
        appliedByUserId: 'user-1',
      }}
      created={{
        academicYears: 1,
        classes: 12,
        subjects: 30,
        classSubjects: 180,
        gradingScales: 1,
      }}
    />
  ),
};

function WithRouter({ children }: { children: React.ReactNode }) {
  const router = React.useMemo(
    () =>
      createRouter({
        routeTree: createRootRoute({ component: () => <>{children}</> }),
        history: createMemoryHistory({ initialEntries: ['/'] }),
      }),
    [children],
  );
  return <RouterProvider router={router} />;
}

export const CustomBlocked: Story = {
  render: () => (
    <WithRouter>
      <BlockedState
        blockers={[
          { entity: 'classes', count: 12 },
          { entity: 'students', count: 340 },
        ]}
      />
    </WithRouter>
  ),
};
